use std::fs;

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_event_service::{
    event_from_task_status, load_recent_index_events, store_index_event,
};
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;

#[test]
fn stores_and_loads_recent_index_events() {
    let root = create_empty_workspace("index-events-roundtrip");
    let root_path = root.to_string_lossy().to_string();
    let status = WorkspaceIndexTaskStatus {
        task_id: "4:refresh-workspace".to_string(),
        root_path: root_path.replace('/', "\\"),
        kind: "refresh-workspace".to_string(),
        status: "running".to_string(),
        reason: "manual".to_string(),
        generation: 4,
        progress_current: 0,
        progress_total: 1,
        started_at: Some(100),
        last_heartbeat_at: Some(100),
        stalled: false,
        finished_at: None,
        symbol_count: None,
        message: Some("Indexing project".to_string()),
        error: None,
    };

    let event = event_from_task_status(&root_path, &status);
    store_index_event(&root_path, &event).unwrap();
    let events = load_recent_index_events(&root_path, 8).unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].root_path, root_path.replace('/', "\\"));
    assert_eq!(events[0].scope, "task");
    assert_eq!(events[0].kind, "refresh-workspace");
    assert_eq!(events[0].phase, "running");
    assert_eq!(events[0].severity, "info");
    assert_eq!(events[0].task_id.as_deref(), Some("4:refresh-workspace"));
    assert_eq!(events[0].generation, Some(4));
    assert!(events[0].payload_json.contains("\"progressCurrent\":0"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn maps_failed_task_status_to_error_event() {
    let root = create_empty_workspace("index-events-failed-status");
    let root_path = root.to_string_lossy().to_string();
    let status = WorkspaceIndexTaskStatus {
        task_id: "5:changed-paths".to_string(),
        root_path: root_path.replace('/', "\\"),
        kind: "changed-paths".to_string(),
        status: "failed".to_string(),
        reason: "watcher".to_string(),
        generation: 5,
        progress_current: 0,
        progress_total: 1,
        started_at: Some(100),
        last_heartbeat_at: Some(180),
        stalled: false,
        finished_at: Some(180),
        symbol_count: None,
        message: None,
        error: Some("parser crashed".to_string()),
    };

    let event = event_from_task_status(&root_path, &status);

    assert_eq!(event.phase, "failed");
    assert_eq!(event.severity, "error");
    assert_eq!(event.message, "parser crashed");

    fs::remove_dir_all(root).unwrap();
}
