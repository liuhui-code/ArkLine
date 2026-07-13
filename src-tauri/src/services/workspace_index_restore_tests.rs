use std::fs;

use rusqlite::Connection;

use crate::models::workspace::{WorkspaceScanSummary, WorkspaceSnapshot};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;

fn snapshot(root_path: &str, truncated: bool) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        root_name: "ArkDemo".to_string(),
        root_path: root_path.to_string(),
        files: vec![
            format!("{root_path}/entry/src/main/ets/pages/Index.ets"),
            format!("{root_path}/entry/src/main/ets/components/IndexCard.ets"),
            format!("{root_path}/AppScope/app.json5"),
        ],
        scan_summary: WorkspaceScanSummary {
            scanned_files: if truncated { 20_000 } else { 3 },
            skipped_entries: if truncated { 8 } else { 0 },
            truncated,
            exclude_rules: vec![".git".to_string(), "node_modules".to_string()],
        },
    }
}

#[test]
fn restores_workspace_catalog_from_persistent_cache() {
    let root = unique_temp_dir("workspace-index-cache");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let writer = WorkspaceIndexRuntime::default();
    writer
        .index_workspace_snapshot(&snapshot(&root_path, false))
        .unwrap();

    let cache_file = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.json");
    assert!(cache_file.exists());

    let reader = WorkspaceIndexRuntime::default();
    let state = reader.get_index_state(&root_path).unwrap();
    let matches = reader.query_quick_open(&root_path, "index", 8).unwrap();

    assert_eq!(state.status.to_string(), "ready");
    assert_eq!(state.file_paths.len(), 3);
    assert_eq!(matches[0].title, "Index.ets");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restores_workspace_catalog_from_sqlite_cache() {
    let root = unique_temp_dir("workspace-index-sqlite-cache");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let writer = WorkspaceIndexRuntime::default();
    writer
        .index_workspace_snapshot(&snapshot(&root_path, false))
        .unwrap();

    let sqlite_file = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    assert!(sqlite_file.exists());

    let reader = WorkspaceIndexRuntime::default();
    let state = reader.get_index_state(&root_path).unwrap();
    let matches = reader.query_quick_open(&root_path, "app", 8).unwrap();

    assert_eq!(state.status.to_string(), "ready");
    assert_eq!(state.file_paths.len(), 3);
    assert_eq!(matches[0].title, "app.json5");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restores_symbols_from_structured_sqlite_tables_without_json_cache() {
    let root = unique_temp_dir("workspace-index-structured-sqlite-cache");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Login.ets"),
        "class LoginController {\n  private submitLogin() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let writer = WorkspaceIndexRuntime::default();
    writer.refresh_workspace_index(&root_path).unwrap();
    let sqlite_file = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(&sqlite_file).unwrap();
    let file_count: i64 = connection
        .query_row("select count(*) from workspace_files", [], |row| row.get(0))
        .unwrap();
    let symbol_count: i64 = connection
        .query_row("select count(*) from workspace_symbols", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(file_count, 1);
    assert_eq!(symbol_count, 2);
    connection
        .execute("delete from workspace_catalog", [])
        .unwrap();
    fs::remove_file(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.json"),
    )
    .unwrap();

    let reader = WorkspaceIndexRuntime::default();
    let state = reader.get_index_state(&root_path).unwrap();
    let matches = reader
        .query_search_everywhere(&root_path, "login", 8)
        .unwrap();

    assert_eq!(state.symbols.len(), 2);
    assert_eq!(matches[0].source, "class");
    assert_eq!(matches[0].title, "LoginController");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restores_index_metadata_from_structured_sqlite_cache() {
    let root = unique_temp_dir("workspace-index-structured-metadata");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let writer = WorkspaceIndexRuntime::default();
    writer
        .index_workspace_snapshot(&snapshot(&root_path, true))
        .unwrap();
    let sqlite_file = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(&sqlite_file).unwrap();
    connection
        .execute("delete from workspace_catalog", [])
        .unwrap();
    fs::remove_file(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.json"),
    )
    .unwrap();

    let reader = WorkspaceIndexRuntime::default();
    let state = reader.get_index_state(&root_path).unwrap();

    assert_eq!(state.status.to_string(), "partial");
    assert!(state.indexed_at.is_some());
    assert!(state
        .partial_reason
        .unwrap()
        .contains("Partial workspace results"));

    fs::remove_dir_all(root).unwrap();
}
