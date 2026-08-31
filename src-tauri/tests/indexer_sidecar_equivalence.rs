use std::fs;
use std::path::Path;

use arkline_lib::indexer_host::{
    IndexerContentRefreshAttempt, IndexerDiscoveryAttempt, IndexerHostRuntime,
    IndexerStubRefreshAttempt,
};
use arkline_lib::indexer_sidecar::IndexerTaskKey;
use rusqlite::{params, Connection};

#[test]
fn real_sidecar_matches_the_workspace_index_contract_fixture() {
    let root = std::env::temp_dir().join(format!(
        "arkline-sidecar-equivalence-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Entry.ets");
    let second = root.join("Feature.ets");
    fs::write(&first, "export class EntryController { start() {} }\n").unwrap();
    fs::write(&second, "export struct FeatureCard { build() {} }\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let paths = vec![
        first.to_string_lossy().to_string(),
        second.to_string_lossy().to_string(),
    ];
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());

    let discovery = runtime.discover_workspace_chunk(task(&root_path, "discovery", 40), None, 64);
    assert!(matches!(discovery, IndexerDiscoveryAttempt::Applied(_)));

    let database = root.join(".arkline/index/workspace-catalog.sqlite");
    let connection = Connection::open(&database).unwrap();
    let root_key = root_path.replace('/', "\\");
    for path in &paths {
        connection
            .execute(
                "insert or ignore into workspace_files (root_path, path) values (?1, ?2)",
                params![root_key, path],
            )
            .unwrap();
    }
    drop(connection);

    let content = runtime.refresh_content_chunk(
        task(&root_path, "content-refresh", 41),
        41,
        paths.clone(),
        Vec::new(),
        || false,
    );
    let stubs = runtime.refresh_stub_chunk(
        task(&root_path, "stub-refresh", 41),
        41,
        paths,
        Vec::new(),
        || false,
    );
    assert!(matches!(content, IndexerContentRefreshAttempt::Applied(_)));
    assert!(matches!(stubs, IndexerStubRefreshAttempt::Applied(_)));

    let connection = Connection::open(database).unwrap();
    let discovered = scalar(
        &connection,
        "select count(*) from workspace_discovered_files",
    );
    let content_files = scalar(
        &connection,
        "select count(*) from workspace_content_files where status = 'ready'",
    );
    let declarations = strings(
        &connection,
        "select name from workspace_stub_declarations
         where name in ('EntryController', 'FeatureCard') order by name",
    );
    assert_eq!(discovered, 2);
    assert_eq!(content_files, 2);
    assert_eq!(declarations, vec!["EntryController", "FeatureCard"]);
    assert_eq!(runtime.snapshot().fallback_count, 0);
    assert_eq!(runtime.snapshot().degraded_count, 0);

    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_does_not_defer_known_excludes_to_an_empty_follow_up_chunk() {
    let root = std::env::temp_dir().join(format!(
        "arkline-sidecar-excluded-frontier-{}",
        uuid::Uuid::new_v4()
    ));
    let module = root.join("module");
    fs::create_dir_all(module.join("build")).unwrap();
    fs::write(module.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(module.join("build").join("generated.ets"), "").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let executable = Path::new(env!("CARGO_BIN_EXE_arkline-indexer"));
    let runtime = IndexerHostRuntime::with_executable(executable.to_path_buf());

    let attempt = runtime.discover_workspace_chunk(task(&root_path, "discovery", 50), None, 1);
    let IndexerDiscoveryAttempt::Applied(result) = attempt else {
        panic!("packaged discovery should be available");
    };

    assert_eq!(result.chunk_file_count, 1);
    assert_eq!(result.excluded_count, 1);
    assert!(!result.has_more);
    assert!(result.pending_directories.is_none());

    fs::remove_dir_all(root).unwrap();
}

fn task(root_path: &str, kind: &str, generation: u64) -> IndexerTaskKey {
    IndexerTaskKey {
        root_path: root_path.to_string(),
        kind: kind.to_string(),
        generation,
        reason: "equivalence-gate".to_string(),
    }
}

fn scalar(connection: &Connection, sql: &str) -> i64 {
    connection.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn strings(connection: &Connection, sql: &str) -> Vec<String> {
    connection
        .prepare(sql)
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
