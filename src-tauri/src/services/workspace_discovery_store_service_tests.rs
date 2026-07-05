use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_discovery_service::{
    WorkspaceDiscoveredFile, WorkspaceDiscoveryCursor,
};
use crate::services::workspace_discovery_store_service::{
    load_discovered_files, load_discovery_cursor, load_ready_discovered_files,
    replace_discovered_file_chunk, update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn schema_creates_discovery_tables_and_domain_version() {
    let connection = Connection::open_in_memory().unwrap();

    ensure_workspace_index_schema(&connection).unwrap();
    let versions = load_workspace_index_schema_versions(&connection).unwrap();

    assert_eq!(versions.get("discovery"), Some(&1));
    assert_eq!(table_count(&connection, "workspace_discovered_files"), 1);
    assert_eq!(table_count(&connection, "workspace_discovery_state"), 1);
}

#[test]
fn discovered_file_chunks_are_replaced_and_loaded_in_path_order() {
    let root = unique_temp_dir("workspace-discovery-store-files");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let files = vec![
        discovered_file("entry\\B.ets", 20),
        discovered_file("entry\\A.ets", 10),
    ];

    replace_discovered_file_chunk(&root_path, 7, &files).unwrap();
    replace_discovered_file_chunk(&root_path, 8, &[discovered_file("entry\\A.ets", 12)]).unwrap();
    let loaded = load_discovered_files(&root_path, 10).unwrap();

    assert_eq!(
        loaded,
        vec!["entry\\A.ets".to_string(), "entry\\B.ets".to_string()]
    );
    assert_eq!(stored_file_generation(&root), 8);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_state_is_upserted_with_cursor_json() {
    let root = unique_temp_dir("workspace-discovery-store-state");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();

    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "running".to_string(),
        discovered_count: 2,
        excluded_count: 1,
        cursor: Some(WorkspaceDiscoveryCursor {
            pending_directories: vec!["entry".to_string()],
        }),
        error: None,
    })
    .unwrap();
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 2,
        status: "ready".to_string(),
        discovered_count: 3,
        excluded_count: 1,
        cursor: None,
        error: None,
    })
    .unwrap();

    assert_eq!(stored_state_status(&root), "ready");
    assert_eq!(stored_state_generation(&root), 2);
    assert_eq!(stored_state_cursor_json(&root), None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_cursor_is_loaded_from_state() {
    let root = unique_temp_dir("workspace-discovery-store-cursor");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let cursor = WorkspaceDiscoveryCursor {
        pending_directories: vec!["entry".to_string(), "feature".to_string()],
    };

    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "running".to_string(),
        discovered_count: 2,
        excluded_count: 0,
        cursor: Some(cursor.clone()),
        error: None,
    })
    .unwrap();

    assert_eq!(load_discovery_cursor(&root_path).unwrap(), Some(cursor));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn ready_discovered_files_only_load_after_discovery_is_ready() {
    let root = unique_temp_dir("workspace-discovery-store-ready-files");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    replace_discovered_file_chunk(&root_path, 1, &[discovered_file("entry\\A.ets", 10)]).unwrap();

    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "running".to_string(),
        discovered_count: 1,
        excluded_count: 0,
        cursor: Some(WorkspaceDiscoveryCursor {
            pending_directories: vec!["entry".to_string()],
        }),
        error: None,
    })
    .unwrap();
    assert_eq!(load_ready_discovered_files(&root_path, 10).unwrap(), None);

    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "ready".to_string(),
        discovered_count: 1,
        excluded_count: 0,
        cursor: None,
        error: None,
    })
    .unwrap();

    assert_eq!(
        load_ready_discovered_files(&root_path, 10).unwrap(),
        Some(vec!["entry\\A.ets".to_string()])
    );

    fs::remove_dir_all(root).unwrap();
}

fn discovered_file(path: &str, size_bytes: u64) -> WorkspaceDiscoveredFile {
    WorkspaceDiscoveredFile {
        path: path.to_string(),
        size_bytes,
        modified_ms: Some(123),
    }
}

fn table_count(connection: &Connection, name: &str) -> i64 {
    connection
        .query_row(
            "select count(*) from sqlite_master where type = 'table' and name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn sqlite_path(root: &PathBuf) -> PathBuf {
    root.join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn stored_file_generation(root: &PathBuf) -> i64 {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row(
            "select generation from workspace_discovered_files where path = 'entry\\A.ets'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn stored_state_status(root: &PathBuf) -> String {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row("select status from workspace_discovery_state", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn stored_state_generation(root: &PathBuf) -> i64 {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row(
            "select generation from workspace_discovery_state",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn stored_state_cursor_json(root: &PathBuf) -> Option<String> {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row(
            "select cursor_json from workspace_discovery_state",
            [],
            |row| row.get(0),
        )
        .unwrap()
}
