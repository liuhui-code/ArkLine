use std::fs;

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_rebuild_service::{
    rebuild_workspace_index_and_start_worker, rebuild_workspace_index_through_manager,
};
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
    assert!(statuses
        .iter()
        .any(|status| { status.kind == "refresh-workspace" && status.status == "queued" }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rebuild_repair_starts_the_worker_and_reaches_ready() {
    let root = unique_temp_dir("workspace-index-rebuild-worker");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    rebuild_workspace_index_and_start_worker(
        index_runtime.clone(),
        index_manager.clone(),
        crate::services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime::default(),
        &root_path,
        |_, _| {},
    )
    .unwrap();

    for _ in 0..400 {
        let pressure = index_manager.get_queue_pressure(&root_path).unwrap();
        let state = index_runtime.get_index_state(&root_path).unwrap();
        if pressure.pending_task_count == 0 && state.status.to_string() == "ready" {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let pressure = index_manager.get_queue_pressure(&root_path).unwrap();
    let state = index_runtime.get_index_state(&root_path).unwrap();
    assert_eq!(pressure.pending_task_count, 0);
    assert_eq!(state.status.to_string(), "ready");
    assert_eq!(state.partial_reason, None);

    fs::remove_dir_all(root).unwrap();
}
