use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::models::workspace::{WorkspaceScanSummary, WorkspaceSnapshot};
use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

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

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn indexes_workspace_snapshot_as_queryable_file_candidates() {
    let runtime = WorkspaceIndexRuntime::default();

    let state = runtime
        .index_workspace_snapshot(&snapshot("C:/samples/ArkDemo", false))
        .unwrap();
    let matches = runtime
        .query_quick_open("C:/samples/ArkDemo", "index", 8)
        .unwrap();

    assert_eq!(state.status.to_string(), "ready");
    assert_eq!(state.file_paths.len(), 3);
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].title, "Index.ets");
    assert_eq!(matches[0].source, "file");
    assert_eq!(matches[0].freshness, "ready");
}

#[test]
fn marks_index_and_candidates_partial_when_scan_was_truncated() {
    let runtime = WorkspaceIndexRuntime::default();

    let state = runtime
        .index_workspace_snapshot(&snapshot("C:/samples/ArkDemo", true))
        .unwrap();
    let matches = runtime
        .query_quick_open("C:/samples/ArkDemo", "index", 8)
        .unwrap();

    assert_eq!(state.status.to_string(), "partial");
    assert!(state.partial_reason.unwrap().contains("20,000"));
    assert_eq!(matches[0].freshness, "partial");
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

#[test]
fn refresh_workspace_index_builds_queryable_content_index() {
    let root = unique_temp_dir("workspace-index-content");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Index.ets"),
        ["struct Index {", "  Text(\"IndexedContent\")", "}"].join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let result = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "indexedcontent".to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 1,
    })
    .unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].line, 2);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn updates_workspace_catalog_incrementally_and_persists_changes() {
    let root = unique_temp_dir("workspace-index-incremental");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let writer = WorkspaceIndexRuntime::default();
    writer
        .index_workspace_snapshot(&snapshot(&root_path, false))
        .unwrap();

    let updater = WorkspaceIndexRuntime::default();
    let added = vec![format!("{root_path}/entry/src/main/ets/pages/About.ets")];
    let removed = vec![format!("{root_path}/entry/src/main/ets/pages/Index.ets")];
    let state = updater
        .update_workspace_files(&root_path, &added, &removed)
        .unwrap();

    assert!(state
        .file_paths
        .iter()
        .any(|path| path.ends_with("About.ets")));
    assert!(!state
        .file_paths
        .iter()
        .any(|path| path.ends_with("Index.ets")));

    let reader = WorkspaceIndexRuntime::default();
    let about_matches = reader.query_quick_open(&root_path, "about", 8).unwrap();
    let index_matches = reader.query_quick_open(&root_path, "index", 8).unwrap();

    assert_eq!(about_matches[0].title, "About.ets");
    assert!(!index_matches
        .iter()
        .any(|candidate| candidate.title == "Index.ets"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refreshes_workspace_catalog_from_filesystem_changes() {
    let root = unique_temp_dir("workspace-index-refresh");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(root.join("entry").join("src").join("Index.ets"), "").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(root.join("entry").join("src").join("About.ets"), "").unwrap();
    fs::remove_file(root.join("entry").join("src").join("Index.ets")).unwrap();
    let state = runtime.refresh_workspace_index(&root_path).unwrap();

    assert_eq!(state.status.to_string(), "ready");
    assert!(state
        .file_paths
        .iter()
        .any(|path| path.ends_with("About.ets")));
    assert!(!state
        .file_paths
        .iter()
        .any(|path| path.ends_with("Index.ets")));

    let reader = WorkspaceIndexRuntime::default();
    let about_matches = reader.query_quick_open(&root_path, "about", 8).unwrap();

    assert_eq!(about_matches[0].title, "About.ets");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_added_and_removed_paths_when_refreshing_changed_workspace() {
    let root = unique_temp_dir("workspace-index-refresh-diff");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(root.join("entry").join("src").join("Index.ets"), "").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    let initial = runtime
        .refresh_workspace_index_with_changes(&root_path)
        .unwrap();
    assert!(initial.changed);
    assert_eq!(initial.added_paths.len(), 1);
    assert!(initial.removed_paths.is_empty());

    let unchanged = runtime
        .refresh_workspace_index_with_changes(&root_path)
        .unwrap();
    assert!(!unchanged.changed);
    assert!(unchanged.added_paths.is_empty());
    assert!(unchanged.removed_paths.is_empty());

    fs::write(root.join("entry").join("src").join("About.ets"), "").unwrap();
    fs::remove_file(root.join("entry").join("src").join("Index.ets")).unwrap();
    let changed = runtime
        .refresh_workspace_index_with_changes(&root_path)
        .unwrap();

    assert!(changed.changed);
    assert_eq!(changed.added_paths.len(), 1);
    assert_eq!(changed.removed_paths.len(), 1);
    assert!(changed.added_paths[0].ends_with("About.ets"));
    assert!(changed.removed_paths[0].ends_with("Index.ets"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refreshes_content_index_for_modified_event_paths_without_file_set_changes() {
    let root = unique_temp_dir("workspace-index-refresh-modified-content");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, "Text(\"BeforeRefresh\")").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(&file_path, "Text(\"AfterRefresh\")").unwrap();

    let result = runtime
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[file_path.to_string_lossy().to_string()],
        )
        .unwrap();
    let after = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "afterrefresh".to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 1,
    })
    .unwrap();
    let before = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "beforerefresh".to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 1,
    })
    .unwrap();

    assert!(result.changed);
    assert!(result.added_paths.is_empty());
    assert!(result.removed_paths.is_empty());
    assert_eq!(after.matches.len(), 1);
    assert!(before.matches.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refreshes_symbol_index_for_modified_event_paths_without_full_symbol_rebuild() {
    let root = unique_temp_dir("workspace-index-refresh-modified-symbol");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, "class BeforeSymbol {}").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(&file_path, "class AfterSymbol {}").unwrap();

    runtime
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[file_path.to_string_lossy().to_string()],
        )
        .unwrap();
    let after_matches = runtime
        .query_search_everywhere(&root_path, "aftersymbol", 8)
        .unwrap();
    let before_matches = runtime
        .query_search_everywhere(&root_path, "beforesymbol", 8)
        .unwrap();

    assert_eq!(after_matches[0].title, "AfterSymbol");
    assert!(!before_matches
        .iter()
        .any(|candidate| candidate.title == "BeforeSymbol"));

    fs::remove_dir_all(root).unwrap();
}
