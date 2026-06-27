use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{
    WorkspaceIndexState, WorkspaceIndexStatus, WorkspaceScanSummary, WorkspaceSnapshot,
    WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_query_service::{
    query_workspace_quick_open, search_workspace_text,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn snapshot(root_path: &str, truncated: bool) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        root_name: "ArkDemo".to_string(),
        root_path: root_path.to_string(),
        files: vec![format!("{root_path}/entry/src/main/ets/pages/Index.ets")],
        scan_summary: WorkspaceScanSummary {
            scanned_files: 1,
            skipped_entries: 0,
            truncated,
            exclude_rules: Vec::new(),
        },
    }
}

#[test]
fn query_facade_preserves_partial_freshness_for_quick_open() {
    let root = unique_temp_dir("workspace-query-facade-partial");
    fs::create_dir_all(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages"),
    )
    .unwrap();
    fs::write(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages")
            .join("Index.ets"),
        "",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&snapshot(&root_path, true))
        .unwrap();

    let matches = query_workspace_quick_open(&runtime, &root_path, "index", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "partial");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_preserves_stale_freshness_from_restored_index() {
    let root = unique_temp_dir("workspace-query-facade-stale");
    fs::create_dir_all(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_path = format!("{root_path}/entry/src/main/ets/pages/Stale.ets");
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.replace('/', "\\")),
            file_paths: vec![indexed_path],
            symbols: Vec::new(),
            indexed_at: Some(1),
            partial_reason: None,
        },
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let matches = query_workspace_quick_open(&runtime, &root_path, "stale", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "stale");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_routes_plain_text_to_index_and_regex_to_file_search() {
    let root = unique_temp_dir("workspace-query-facade-text");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"QueryFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let plain =
        search_workspace_text(&runtime, plain_request(&root_path, "queryfacadetarget")).unwrap();
    let regex =
        search_workspace_text(&runtime, plain_request(&root_path, "/Text\\(\".+\"\\)/")).unwrap();

    assert_eq!(plain.matches.len(), 1);
    assert_eq!(regex.matches.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

fn plain_request(root_path: &str, query: &str) -> WorkspaceTextSearchRequest {
    WorkspaceTextSearchRequest {
        root_path: root_path.to_string(),
        query: query.to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 0,
    }
}
