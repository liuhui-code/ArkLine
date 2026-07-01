use crate::services::workspace_index_chunk_service::plan_refresh_continuation;
use crate::services::workspace_index_continuation_task_service::{
    next_refresh_continuation_task, schedule_refresh_continuations,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;
use std::sync::{Arc, Mutex};

#[test]
fn creates_next_full_refresh_continuation_task_from_remaining_chunk() {
    let mut continuation =
        plan_refresh_continuation("/workspace", 7, vec!["A.ets", "B.ets", "C.ets"], 2);
    let first = continuation.pop_next_chunk().unwrap();

    let task = next_refresh_continuation_task(&continuation, "manual")
        .expect("remaining chunk should become a continuation task");

    assert_eq!(first.paths, vec!["A.ets", "B.ets"]);
    assert_eq!(task.root_path, "/workspace");
    assert_eq!(task.kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(task.priority, WorkspaceIndexTaskPriority::FullRefresh);
    assert_eq!(task.changed_paths, vec!["C.ets"]);
    assert_eq!(task.generation, 0);
    assert_eq!(task.reason, "full-refresh-continuation:manual");
}

#[test]
fn does_not_create_continuation_task_when_chunks_are_complete() {
    let mut continuation = plan_refresh_continuation("/workspace", 7, vec!["A.ets"], 2);
    continuation.pop_next_chunk().unwrap();

    assert!(next_refresh_continuation_task(&continuation, "manual").is_none());
}

#[test]
fn creates_continuation_task_from_string_paths() {
    let mut continuation = plan_refresh_continuation(
        "/workspace",
        7,
        vec!["A.ets".to_string(), "B.ets".to_string()],
        1,
    );
    continuation.pop_next_chunk().unwrap();

    let task = next_refresh_continuation_task(&continuation, "manual").unwrap();

    assert_eq!(task.changed_paths, vec!["B.ets"]);
}

#[test]
fn schedules_continuation_tasks_from_worker_results() {
    let mut continuation = plan_refresh_continuation(
        "/workspace",
        7,
        vec!["A.ets".to_string(), "B.ets".to_string()],
        1,
    );
    continuation.pop_next_chunk().unwrap();
    let result = WorkspaceIndexTaskResult {
        root_path: "/workspace".to_string(),
        kind: "refresh-workspace".to_string(),
        status: "partial".to_string(),
        reason: "refresh-workspace".to_string(),
        generation: 7,
        started_at: Some(100),
        finished_at: Some(200),
        message: None,
        error: None,
        refresh_result: None,
        refresh_continuation: Some(continuation),
        sdk_symbol_count: None,
    };
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));

    let summary = schedule_refresh_continuations(&scheduler, &[result]).unwrap();
    let tasks = scheduler.lock().unwrap().pending_tasks();

    assert_eq!(summary.root_paths, vec!["/workspace"]);
    assert!(summary.superseded_tasks.is_empty());
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(tasks[0].priority, WorkspaceIndexTaskPriority::FullRefresh);
    assert_eq!(tasks[0].changed_paths, vec!["B.ets"]);
}
