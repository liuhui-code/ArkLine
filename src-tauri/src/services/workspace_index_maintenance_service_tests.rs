use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_maintenance_service::{
    clear_workspace_index, rebuild_workspace_index,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn clears_persistent_and_in_memory_workspace_index() {
    let root = unique_temp_dir("workspace-index-clear");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"ClearIndex\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    assert!(inspect_workspace_index(&root_path).unwrap().file_count > 0);

    clear_workspace_index(&runtime, &root_path).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let state = runtime.get_index_state(&root_path).unwrap();

    assert_eq!(diagnostics.file_count, 0);
    assert_eq!(diagnostics.symbol_count, 0);
    assert_eq!(diagnostics.content_line_count, 0);
    assert_eq!(diagnostics.fingerprint_count, 0);
    assert!(state.file_paths.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rebuilds_workspace_index_after_clearing_cache() {
    let root = unique_temp_dir("workspace-index-rebuild");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"RebuildIndex\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    rebuild_workspace_index(&runtime, &root_path).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let matches = runtime
        .query_search_everywhere(&root_path, "Index", 8)
        .unwrap();

    assert_eq!(diagnostics.file_count, 1);
    assert!(diagnostics.symbol_count > 0);
    assert!(matches.iter().any(|candidate| candidate.title == "Index"));

    fs::remove_dir_all(root).unwrap();
}
