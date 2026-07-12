use std::fs;

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_event_service::load_recent_index_events;
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
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(100),
        last_heartbeat_at: Some(200),
        stalled: false,
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
fn storing_task_status_also_writes_unified_index_event() {
    let root = create_empty_workspace("task-journal-event-bridge");
    let root_path = root.to_string_lossy().to_string();
    let status = WorkspaceIndexTaskStatus {
        task_id: "8:refresh-workspace".to_string(),
        root_path: root_path.replace('/', "\\"),
        kind: "refresh-workspace".to_string(),
        status: "ready".to_string(),
        reason: "manual".to_string(),
        generation: 8,
        progress_current: 1,
        progress_total: 1,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(100),
        last_heartbeat_at: Some(200),
        stalled: false,
        finished_at: Some(200),
        symbol_count: Some(12),
        message: Some("Indexed 12 files".to_string()),
        error: None,
    };

    store_task_status(&root_path, &status).unwrap();
    let events = load_recent_index_events(&root_path, 8).unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].scope, "task");
    assert_eq!(events[0].kind, "refresh-workspace");
    assert_eq!(events[0].phase, "ready");
    assert_eq!(events[0].severity, "info");
    assert_eq!(events[0].message, "Indexed 12 files");
    assert_eq!(events[0].task_id.as_deref(), Some("8:refresh-workspace"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_failed_task_statuses_write_retry_backoff_event() {
    let root = create_empty_workspace("task-journal-retry-backoff");
    let root_path = root.to_string_lossy().to_string();

    store_task_status(&root_path, &failed_status(&root_path, 9)).unwrap();
    store_task_status(&root_path, &failed_status(&root_path, 10)).unwrap();

    let events = load_recent_index_events(&root_path, 8).unwrap();
    let backoff = events
        .iter()
        .find(|event| event.scope == "scheduler" && event.phase == "backoff")
        .expect("second consecutive failure should emit backoff event");

    assert_eq!(backoff.kind, "changed-paths");
    assert_eq!(backoff.severity, "warning");
    assert!(backoff.message.contains("failed 2 consecutive"));
    assert!(backoff.payload_json.contains("\"retryAfterMs\":2000"));

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

fn failed_status(root_path: &str, generation: u64) -> WorkspaceIndexTaskStatus {
    WorkspaceIndexTaskStatus {
        task_id: format!("{generation}:changed-paths"),
        root_path: root_path.replace('/', "\\"),
        kind: "changed-paths".to_string(),
        status: "failed".to_string(),
        reason: "watcher".to_string(),
        generation,
        progress_current: 1,
        progress_total: 1,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(100),
        last_heartbeat_at: Some(200),
        stalled: false,
        finished_at: Some(200),
        symbol_count: None,
        message: None,
        error: Some("index failed".to_string()),
    }
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

#[test]
fn manager_does_not_restore_orphaned_running_statuses_as_active() {
    let root = create_empty_workspace("task-journal-orphaned-running");
    let root_path = root.to_string_lossy().to_string();
    let running = WorkspaceIndexTaskStatus {
        task_id: "3:changed-paths".to_string(),
        root_path: root_path.replace('/', "\\"),
        kind: "changed-paths".to_string(),
        status: "running".to_string(),
        reason: "watcher".to_string(),
        generation: 3,
        progress_current: 0,
        progress_total: 1,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(100),
        last_heartbeat_at: Some(100),
        stalled: false,
        finished_at: None,
        symbol_count: None,
        message: None,
        error: None,
    };

    store_task_status(&root_path, &running).unwrap();
    let restored = WorkspaceIndexManagerRuntime::default()
        .get_index_task_statuses(&root_path)
        .unwrap();

    assert!(restored.is_empty());

    fs::remove_dir_all(root).unwrap();
}
