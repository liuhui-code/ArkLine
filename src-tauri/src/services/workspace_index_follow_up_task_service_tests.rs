use std::sync::{Arc, Mutex};

use crate::services::workspace_discovery_task_service::discovery_task_reason;
use crate::services::workspace_index_follow_up_task_service::schedule_index_follow_up_tasks;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexScheduler;
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult as TaskResult;

#[test]
fn schedules_discovery_after_open_workspace_result() {
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));
    let results = vec![TaskResult {
        root_path: "/tmp/project".to_string(),
        kind: "open-workspace".to_string(),
        status: "ready".to_string(),
        reason: "open-workspace".to_string(),
        generation: 1,
        started_at: None,
        finished_at: None,
        message: None,
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    }];

    let summary = schedule_index_follow_up_tasks(&scheduler, &results).unwrap();
    let pending = scheduler
        .lock()
        .unwrap()
        .pending_tasks_for_root("/tmp/project");

    assert_eq!(summary.root_paths, vec!["/tmp/project".to_string()]);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].reason, discovery_task_reason());
}

#[test]
fn schedules_background_refresh_after_discovery_ready_result() {
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));
    let results = vec![TaskResult {
        root_path: "/tmp/project".to_string(),
        kind: "discovery".to_string(),
        status: "ready".to_string(),
        reason: discovery_task_reason().to_string(),
        generation: 2,
        started_at: None,
        finished_at: None,
        message: None,
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    }];

    let summary = schedule_index_follow_up_tasks(&scheduler, &results).unwrap();
    let pending = scheduler
        .lock()
        .unwrap()
        .pending_tasks_for_root("/tmp/project");

    assert_eq!(summary.root_paths, vec!["/tmp/project".to_string()]);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].reason, "background-refresh-after-open");
}
