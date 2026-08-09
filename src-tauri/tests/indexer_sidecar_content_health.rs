use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use arkline_lib::indexer_host::{
    IndexerContentRefreshAttempt, IndexerHostRuntime, IndexerHostSession,
};
use arkline_lib::indexer_sidecar::IndexerTaskKey;
use rusqlite::Connection;

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
    assert!(wait_for_trigram_text(&database_path, "newerGeneration"));

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

fn wait_for_trigram_text(database_path: &Path, expected: &str) -> bool {
    let deadline = Instant::now() + Duration::from_secs(7);
    while Instant::now() < deadline {
        let text = Connection::open(database_path).ok().and_then(|connection| {
            connection
                .query_row(
                    "select text from workspace_content_trigram_fts limit 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
        });
        if text.is_some_and(|text| text.contains(expected)) {
            return true;
        }
        thread::sleep(Duration::from_millis(25));
    }
    false
}

fn unique_temp_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "arkline-indexer-content-integration-{}",
        uuid::Uuid::new_v4()
    ))
}
