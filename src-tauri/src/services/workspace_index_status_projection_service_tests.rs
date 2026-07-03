use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_status_projection_service::mark_stalled_task_statuses;

#[test]
fn marks_running_project_task_stalled_after_heartbeat_timeout() {
    let mut statuses = vec![
        WorkspaceIndexTaskStatus {
            task_id: "4:refresh-workspace".to_string(),
            root_path: "/workspace".to_string(),
            kind: "refresh-workspace".to_string(),
            status: "running".to_string(),
            reason: "refresh-workspace".to_string(),
            generation: 4,
            progress_current: 0,
            progress_total: 1,
            started_at: Some(1_000),
            last_heartbeat_at: Some(1_000),
            stalled: false,
            finished_at: None,
            symbol_count: None,
            message: None,
            error: None,
        },
        WorkspaceIndexTaskStatus {
            task_id: "5:refresh-workspace".to_string(),
            root_path: "/workspace".to_string(),
            kind: "refresh-workspace".to_string(),
            status: "queued".to_string(),
            reason: "refresh-workspace".to_string(),
            generation: 5,
            progress_current: 0,
            progress_total: 1,
            started_at: None,
            last_heartbeat_at: None,
            stalled: false,
            finished_at: None,
            symbol_count: None,
            message: None,
            error: None,
        },
    ];

    mark_stalled_task_statuses(&mut statuses, 61_001);

    assert!(statuses[0].stalled);
    assert_eq!(statuses[0].message.as_deref(), Some("No heartbeat for 60s"));
    assert!(!statuses[1].stalled);
}
