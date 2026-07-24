use std::fs;
use std::path::{Path, PathBuf};

use arkline_lib::indexer_host::{
    IndexerContentRefreshAttempt, IndexerDiscoveryAttempt, IndexerHostRuntime, IndexerHostSession,
    IndexerStubRefreshAttempt,
};
use arkline_lib::indexer_sidecar::IndexerTaskKey;
use rusqlite::Connection;

#[test]
fn host_negotiates_health_with_the_real_indexer_binary() {
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let mut session = IndexerHostSession::start(executable).expect("indexer should launch");

    let capabilities = session.health().expect("health should negotiate");

    assert!(capabilities.contains(&"health".to_string()));
    assert!(capabilities.contains(&"discoveryChunk".to_string()));
    assert!(capabilities.contains(&"discoveryPrepareChunk".to_string()));
    assert!(capabilities.contains(&"contentRefreshChunk".to_string()));
    assert!(capabilities.contains(&"contentResourceBudget".to_string()));
    assert!(capabilities.contains(&"stubRefreshChunk".to_string()));
    assert!(session.process_id() > 0);
}

#[test]
fn discovery_runtime_prepares_in_sidecar_and_publishes_through_writer_actor() {
    let root = unique_temp_root();
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Entry.ets"), "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());

    let result = runtime.discover_workspace_chunk(
        IndexerTaskKey {
            root_path: root_path.clone(),
            kind: "discovery".to_string(),
            generation: 5,
            reason: "actor-discovery-integration".to_string(),
        },
        None,
        64,
    );

    let IndexerDiscoveryAttempt::Applied(result) = result else {
        panic!("discovery actor publication should apply");
    };
    assert_eq!(result.chunk_file_count, 1);
    assert!(result.publication_artifact.is_none());
    assert!(result
        .publication_profile
        .stages
        .iter()
        .any(|stage| stage.name == "discoveryCommit"));
    let snapshot = runtime.snapshot();
    assert!(snapshot
        .publication_writer_metrics
        .is_some_and(|metrics| metrics.sample_count > 0));
    let connection =
        Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let discovered_count: i64 = connection
        .query_row(
            "select count(*) from workspace_discovered_files",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let task_status: String = connection
        .query_row(
            "select status from workspace_index_task_journal
             where task_id = '5:discovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(discovered_count, 1);
    assert_eq!(task_status, "ready");
    drop(connection);
    let process_id = runtime.snapshot().discovery_process_id;
    let stale = runtime.discover_workspace_chunk(
        IndexerTaskKey {
            root_path: root_path.clone(),
            kind: "discovery".to_string(),
            generation: 4,
            reason: "stale-discovery-integration".to_string(),
        },
        None,
        64,
    );
    assert_eq!(stale, IndexerDiscoveryAttempt::Cancelled);
    assert_eq!(runtime.snapshot().fallback_count, 0);
    assert_eq!(runtime.snapshot().discovery_process_id, process_id);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_runtime_bounds_a_twenty_thousand_path_sidecar_cursor() {
    let root = unique_temp_root();
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let pending = (0..20_000)
        .map(|index| {
            root.join(format!("module/src/main/ets/Page{index:06}.ets"))
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());

    let result = runtime.discover_workspace_chunk(
        IndexerTaskKey {
            root_path,
            kind: "discovery".to_string(),
            generation: 6,
            reason: "bounded-cursor-integration".to_string(),
        },
        Some(pending.clone()),
        1_024,
    );

    let IndexerDiscoveryAttempt::Applied(result) = result else {
        panic!(
            "bounded discovery cursor should remain on the sidecar: {:?}",
            runtime.snapshot()
        );
    };
    let remaining = result.pending_directories.unwrap();
    assert!(result.has_more);
    assert!(!remaining.is_empty());
    assert!(remaining.len() < pending.len());
    assert_eq!(remaining.last(), pending.last());
    let connection =
        Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let cursor_json: String = connection
        .query_row(
            "select cursor_json from workspace_discovery_state limit 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let persisted_remaining: Vec<String> = serde_json::from_str(&cursor_json).unwrap();
    assert_eq!(persisted_remaining, remaining);
    drop(connection);
    assert_eq!(runtime.snapshot().fallback_count, 0);
    assert_eq!(runtime.snapshot().restart_count, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stub_refresh_is_bounded_idempotent_and_rejects_old_generations() {
    let root = unique_temp_root();
    fs::create_dir_all(root.join("src")).unwrap();
    let good = root.join("src/Good.ets");
    let broken = root.join("src/Broken.ets");
    fs::write(&good, "export class GoodController {}\n").unwrap();
    fs::write(&broken, "export struct Broken {\n  build() {\n").unwrap();
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let root_path = root.to_string_lossy().to_string();
    let mut session = IndexerHostSession::start(executable).unwrap();
    session.health().unwrap();

    let discovery_task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "discovery".to_string(),
        generation: 31,
        reason: "stub-refresh-setup".to_string(),
    };
    let mut cursor = None;
    loop {
        let chunk = session
            .discover_workspace_chunk(discovery_task.clone(), cursor, 16)
            .unwrap();
        cursor = chunk.pending_directories;
        if !chunk.has_more {
            break;
        }
    }

    let database_path = root.join(".arkline/index/workspace-catalog.sqlite");
    let connection = Connection::open(&database_path).unwrap();
    let root_key = root_path.replace('/', "\\");
    for path in [&good, &broken] {
        connection
            .execute(
                "insert into workspace_files (root_path, path) values (?1, ?2)",
                (&root_key, path.to_string_lossy().as_ref()),
            )
            .unwrap();
    }
    drop(connection);

    let stub_task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "stub-refresh".to_string(),
        generation: 32,
        reason: "full-refresh-deep:test".to_string(),
    };
    let changed_paths = vec![
        good.to_string_lossy().to_string(),
        broken.to_string_lossy().to_string(),
    ];
    drop(session);
    let first_runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());
    let first = first_runtime.refresh_stub_chunk(
        stub_task.clone(),
        100,
        changed_paths.clone(),
        Vec::new(),
        || false,
    );
    let IndexerStubRefreshAttempt::Applied(first) = first else {
        panic!("first stub publication should apply");
    };
    assert_eq!(first.parsed_file_count, 2);
    assert!(first.parse_error_count > 0);

    drop(first_runtime);
    let runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());
    assert!(matches!(
        runtime.refresh_stub_chunk(
            stub_task.clone(),
            100,
            changed_paths.clone(),
            Vec::new(),
            || false,
        ),
        IndexerStubRefreshAttempt::Applied(_)
    ));
    let connection = Connection::open(&database_path).unwrap();
    let good_count: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations where name = 'GoodController'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(good_count, 1);
    drop(connection);

    fs::write(&good, "export class NewerController {}\n").unwrap();
    assert!(matches!(
        runtime.refresh_stub_chunk(
            stub_task.clone(),
            101,
            vec![changed_paths[0].clone()],
            Vec::new(),
            || false,
        ),
        IndexerStubRefreshAttempt::Applied(_)
    ));
    let stub_process_id = runtime.snapshot().stub_process_id;
    let stale = runtime.refresh_stub_chunk(
        stub_task.clone(),
        100,
        vec![changed_paths[1].clone()],
        Vec::new(),
        || false,
    );
    assert_eq!(stale, IndexerStubRefreshAttempt::Cancelled);
    assert_eq!(runtime.snapshot().fallback_count, 0);
    assert_eq!(runtime.snapshot().stub_process_id, stub_process_id);
    fs::remove_file(&good).unwrap();
    let removed = runtime.refresh_stub_chunk(
        stub_task,
        102,
        Vec::new(),
        vec![changed_paths[0].clone()],
        || false,
    );
    assert!(
        matches!(removed, IndexerStubRefreshAttempt::Applied(_)),
        "{:?}",
        runtime.snapshot()
    );
    let connection = Connection::open(&database_path).unwrap();
    let removed_count: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations where name = 'NewerController'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(removed_count, 0);
    drop(connection);
    fs::write(&good, "export class StaleResurrection {}\n").unwrap();
    let stale = runtime.refresh_stub_chunk(
        IndexerTaskKey {
            root_path: root_path.clone(),
            kind: "stub-refresh".to_string(),
            generation: 33,
            reason: "stale-after-delete".to_string(),
        },
        101,
        vec![changed_paths[0].clone()],
        Vec::new(),
        || false,
    );
    assert_eq!(stale, IndexerStubRefreshAttempt::Cancelled);
    assert_eq!(runtime.snapshot().fallback_count, 0);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_refresh_replays_across_restart_and_rejects_old_generations() {
    let root = unique_temp_root();
    fs::create_dir_all(root.join("src")).unwrap();
    let source = root.join("src/Entry.ets");
    fs::write(&source, "const firstGeneration = 1;\n").unwrap();
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let mut first = IndexerHostSession::start(executable).unwrap();
    first.health().unwrap();

    let discovery_task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "discovery".to_string(),
        generation: 41,
        reason: "content-refresh-setup".to_string(),
    };
    let mut cursor = None;
    loop {
        let chunk = first
            .discover_workspace_chunk(discovery_task.clone(), cursor, 16)
            .unwrap();
        cursor = chunk.pending_directories;
        if !chunk.has_more {
            break;
        }
    }
    let database_path = root.join(".arkline/index/workspace-catalog.sqlite");
    let connection = Connection::open(&database_path).unwrap();
    connection
        .execute(
            "insert into workspace_files (root_path, path) values (?1, ?2)",
            (root_path.replace('/', "\\"), &source_path),
        )
        .unwrap();
    drop(connection);

    let task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "content-refresh".to_string(),
        generation: 42,
        reason: "full-refresh-deep:test".to_string(),
    };
    drop(first);
    let first_runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());
    let result = first_runtime.refresh_content_chunk(
        task.clone(),
        100,
        vec![source_path.clone()],
        Vec::new(),
        || false,
    );
    let IndexerContentRefreshAttempt::Applied(result) = result else {
        panic!("first content publication should apply");
    };
    assert_eq!(result.indexed_file_count, 1);
    assert_eq!(result.indexed_line_count, 1);
    assert_eq!(result.resource_limited_file_count, 0);
    assert_eq!(result.processed_source_bytes, 27);
    let writer_metrics = first_runtime
        .snapshot()
        .publication_writer_metrics
        .expect("writer actor should return publication telemetry");
    assert!(writer_metrics.sample_count > 0);
    assert!(writer_metrics.hold_max_us > 0);
    drop(first_runtime);

    let second = IndexerHostRuntime::with_executable(executable.to_path_buf());
    assert!(matches!(
        second.refresh_content_chunk(
            task.clone(),
            100,
            vec![source_path.clone()],
            Vec::new(),
            || false,
        ),
        IndexerContentRefreshAttempt::Applied(_)
    ));
    let connection = Connection::open(&database_path).unwrap();
    let replay_count: i64 = connection
        .query_row("select count(*) from workspace_content_lines", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(replay_count, 1);
    drop(connection);

    fs::write(&source, "const newerGeneration = 2;\n").unwrap();
    assert!(matches!(
        second.refresh_content_chunk(
            task.clone(),
            101,
            vec![source_path.clone()],
            Vec::new(),
            || false,
        ),
        IndexerContentRefreshAttempt::Applied(_)
    ));
    let stale = second.refresh_content_chunk(
        task.clone(),
        100,
        vec![source_path.clone()],
        Vec::new(),
        || false,
    );
    assert_eq!(stale, IndexerContentRefreshAttempt::Cancelled);
    assert_eq!(second.snapshot().fallback_count, 0);
    let connection = Connection::open(&database_path).unwrap();
    let text: String = connection
        .query_row(
            "select text from workspace_content_trigram_fts",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(text.contains("newerGeneration"));
    drop(connection);
    fs::remove_file(&source).unwrap();
    let removed = second.refresh_content_chunk(task, 102, Vec::new(), vec![source_path], || false);
    assert!(
        matches!(removed, IndexerContentRefreshAttempt::Applied(_)),
        "{:?}",
        second.snapshot()
    );
    let connection = Connection::open(&database_path).unwrap();
    let removed_count: i64 = connection
        .query_row("select count(*) from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(removed_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_resumes_from_the_durable_cursor_after_process_restart() {
    let root = unique_temp_root();
    fs::create_dir_all(root.join("src/nested")).unwrap();
    for index in 0..5 {
        fs::write(
            root.join(format!("src/nested/File{index}.ets")),
            "export {}\n",
        )
        .unwrap();
    }
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let task = IndexerTaskKey {
        root_path: root.to_string_lossy().to_string(),
        kind: "discovery".to_string(),
        generation: 11,
        reason: "integration-restart".to_string(),
    };
    let mut first = IndexerHostSession::start(executable).unwrap();
    first.health().unwrap();
    let first_chunk = first
        .discover_workspace_chunk(task.clone(), None, 2)
        .unwrap();
    assert!(first_chunk.has_more);

    let database_path = root.join(".arkline/index/workspace-catalog.sqlite");
    let connection = Connection::open(&database_path).unwrap();
    let event_count_before_replay: i64 = connection
        .query_row(
            "select count(*) from workspace_index_events
             where task_id = '11:discovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    drop(connection);

    let replay = first
        .discover_workspace_chunk(task.clone(), None, 2)
        .unwrap();
    assert_eq!(replay.chunk_file_count, 0);
    assert_eq!(replay.pending_directories, first_chunk.pending_directories);
    drop(first);

    let connection = Connection::open(&database_path).unwrap();
    let event_count_after_replay: i64 = connection
        .query_row(
            "select count(*) from workspace_index_events
             where task_id = '11:discovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(event_count_after_replay, event_count_before_replay);
    let cursor_json: String = connection
        .query_row(
            "select cursor_json from workspace_discovery_state",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let (task_status, task_reason): (String, String) = connection
        .query_row(
            "select status, reason from workspace_index_task_journal
             where task_id = '11:discovery'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let task_event_count: i64 = connection
        .query_row(
            "select count(*) from workspace_index_events
             where task_id = '11:discovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(task_status, "partial");
    assert_eq!(task_reason, "integration-restart");
    assert!(task_event_count > 0);
    let mut cursor = Some(serde_json::from_str::<Vec<String>>(&cursor_json).unwrap());
    drop(connection);

    let mut second = IndexerHostSession::start(executable).unwrap();
    second.health().unwrap();
    loop {
        let chunk = second
            .discover_workspace_chunk(task.clone(), cursor, 2)
            .unwrap();
        cursor = chunk.pending_directories;
        if !chunk.has_more {
            break;
        }
    }
    drop(second);

    let connection = Connection::open(database_path).unwrap();
    let (status, generation, count): (String, i64, i64) = connection
        .query_row(
            "select status, generation, discovered_count from workspace_discovery_state",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(status, "ready");
    assert_eq!(generation, 11);
    assert_eq!(count, 5);
    let task_status: String = connection
        .query_row(
            "select status from workspace_index_task_journal
             where task_id = '11:discovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(task_status, "ready");

    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

fn unique_temp_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "arkline-indexer-integration-{}",
        uuid::Uuid::new_v4()
    ))
}
