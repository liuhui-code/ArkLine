use std::fs;

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_rebuild_service::rebuild_workspace_index_through_manager;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;

#[test]
fn rebuild_repair_clears_cache_and_queues_manager_refresh() {
    let root = unique_temp_dir("workspace-index-rebuild-manager");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    rebuild_workspace_index_through_manager(&index_runtime, &index_manager, &root_path).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let statuses = index_manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(diagnostics.file_count, 0);
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued"
    }));

    fs::remove_dir_all(root).unwrap();
}
