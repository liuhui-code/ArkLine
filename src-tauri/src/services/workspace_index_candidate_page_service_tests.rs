use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceScanSummary, WorkspaceSnapshot};
use crate::services::workspace_index_candidate_page_service::{
    normalize_candidate_page_limit, query_workspace_candidate_page,
    query_workspace_file_symbol_page,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn file_symbol_page_returns_cursor_without_repeating_results() {
    let root = unique_temp_dir("workspace-file-symbol-page");
    let source_dir = root.join("entry/src/main/ets/pages");
    fs::create_dir_all(&source_dir).unwrap();
    let file_path = source_dir.join("Index.ets");
    fs::write(
        &file_path,
        "class Index {\n  alpha() {}\n  beta() {}\n  gamma() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.clone(),
            files: vec![file_path.to_string_lossy().to_string()],
            scan_summary: WorkspaceScanSummary {
                scanned_files: 1,
                skipped_entries: 0,
                truncated: false,
                exclude_rules: Vec::new(),
            },
        })
        .unwrap();

    let first = query_workspace_file_symbol_page(
        &runtime,
        &root_path,
        &file_path.to_string_lossy(),
        "",
        2,
        None,
    )
    .unwrap();
    let second = query_workspace_file_symbol_page(
        &runtime,
        &root_path,
        &file_path.to_string_lossy(),
        "",
        2,
        first.next_cursor,
    )
    .unwrap();

    assert_eq!(first.items.len(), 2);
    assert_eq!(second.items.len(), 2);
    assert_ne!(first.items[0].title, second.items[0].title);
    assert_eq!(second.next_cursor, None);
}

#[test]
fn candidate_page_returns_cursor_without_repeating_results() {
    let root = unique_temp_dir("workspace-candidate-page");
    fs::create_dir_all(root.join("entry/src/main/ets/pages")).unwrap();
    let files = ["Alpha.ets", "AlphaDetails.ets", "AlphaList.ets"];
    for file in files {
        fs::write(root.join("entry/src/main/ets/pages").join(file), "").unwrap();
    }
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.clone(),
            files: files
                .iter()
                .map(|file| format!("{root_path}/entry/src/main/ets/pages/{file}"))
                .collect(),
            scan_summary: WorkspaceScanSummary {
                scanned_files: files.len(),
                skipped_entries: 0,
                truncated: false,
                exclude_rules: Vec::new(),
            },
        })
        .unwrap();

    let first = query_workspace_candidate_page(
        &runtime,
        &root_path,
        "Alpha",
        WorkspaceIndexQueryScope::Files,
        2,
        None,
    )
    .unwrap();
    let second = query_workspace_candidate_page(
        &runtime,
        &root_path,
        "Alpha",
        WorkspaceIndexQueryScope::Files,
        2,
        first.next_cursor,
    )
    .unwrap();

    assert_eq!(first.items.len(), 2);
    assert_eq!(second.items.len(), 1);
    assert_ne!(first.items[0].path, second.items[0].path);
    assert_eq!(second.next_cursor, None);
}

#[test]
fn normalizes_candidate_page_limits() {
    assert_eq!(normalize_candidate_page_limit(0), 1);
    assert_eq!(normalize_candidate_page_limit(50), 50);
    assert_eq!(normalize_candidate_page_limit(usize::MAX), 100);
}

#[test]
fn candidate_page_caps_oversized_requested_limit() {
    let root = unique_temp_dir("workspace-candidate-page-cap");
    fs::create_dir_all(root.join("entry/src/main/ets/pages")).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let files = (0..105)
        .map(|index| format!("Alpha{index:03}.ets"))
        .collect::<Vec<_>>();
    for file in &files {
        fs::write(root.join("entry/src/main/ets/pages").join(file), "").unwrap();
    }
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.clone(),
            files: files
                .iter()
                .map(|file| format!("{root_path}/entry/src/main/ets/pages/{file}"))
                .collect(),
            scan_summary: WorkspaceScanSummary {
                scanned_files: files.len(),
                skipped_entries: 0,
                truncated: false,
                exclude_rules: Vec::new(),
            },
        })
        .unwrap();

    let page = query_workspace_candidate_page(
        &runtime,
        &root_path,
        "Alpha",
        WorkspaceIndexQueryScope::Files,
        usize::MAX,
        None,
    )
    .unwrap();

    assert_eq!(page.items.len(), 100);
    assert_eq!(page.next_cursor, Some(100));
    fs::remove_dir_all(root).unwrap();
}
