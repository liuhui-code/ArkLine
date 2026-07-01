use std::fs;

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_journal_service::{
    load_recent_task_statuses, store_task_status,
};
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;

#[test]
fn stores_and_loads_recent_task_statuses() {
    let root = create_empty_workspace("task-journal-roundtrip");
    let root_path = root.to_string_lossy().to_string();
    let status = WorkspaceIndexTaskStatus {
        task_id: "7:refresh-workspace".to_string(),
        root_path: root_path.replace('/', "\\"),
        kind: "refresh-workspace".to_string(),
        status: "ready".to_string(),
        reason: "manual".to_string(),
        generation: 7,
        progress_current: 1,
        progress_total: 1,
        started_at: Some(100),
        finished_at: Some(200),
        symbol_count: Some(3),
        message: Some("done".to_string()),
        error: None,
    };

    store_task_status(&root_path, &status).unwrap();
    let statuses = load_recent_task_statuses(&root_path, 8).unwrap();

    assert_eq!(statuses, vec![status]);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn manager_persists_queued_task_statuses() {
    let root = create_empty_workspace("task-journal-manager-queued");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    let statuses = load_recent_task_statuses(&root_path, 8).unwrap();

    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].task_id, "1:refresh-workspace");
    assert_eq!(statuses[0].status, "queued");
    assert_eq!(statuses[0].progress_current, 0);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn manager_loads_persisted_terminal_task_statuses() {
    let root = create_empty_workspace("task-journal-manager-ready");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index { build() {} }\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager.drain_index_task_results(&index_runtime).unwrap();
    let restored = WorkspaceIndexManagerRuntime::default()
        .get_index_task_statuses(&root_path)
        .unwrap();

    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].task_id, "1:refresh-workspace");
    assert_eq!(restored[0].status, "ready");
    assert_eq!(restored[0].progress_current, 1);
    assert_eq!(restored[0].progress_total, 1);

    fs::remove_dir_all(root).unwrap();
}
