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
fn creates_next_full_refresh_continuation_task_from_remaining_paths() {
    let mut continuation =
        plan_refresh_continuation("/workspace", 7, vec!["A.ets", "B.ets", "C.ets"], 1);
    let first = continuation.pop_next_chunk().unwrap();

    let task = next_refresh_continuation_task(&continuation, "manual")
        .expect("remaining paths should become a continuation task");

    assert_eq!(first.paths, vec!["A.ets"]);
    assert_eq!(task.root_path, "/workspace");
    assert_eq!(task.kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(task.priority, WorkspaceIndexTaskPriority::FullRefresh);
    assert_eq!(task.changed_paths, vec!["B.ets", "C.ets"]);
    assert_eq!(task.generation, 0);
    assert_eq!(task.reason, "full-refresh-files:manual");
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
fn deep_layer_continuation_runs_at_background_priority() {
    let mut continuation = plan_refresh_continuation("/workspace", 7, vec!["A.ets", "B.ets"], 1);
    continuation.pop_next_chunk().unwrap();

    let task = next_refresh_continuation_task(&continuation, "full-refresh-deep:refresh-workspace")
        .expect("remaining paths should become a deep continuation task");

    assert_eq!(task.priority, WorkspaceIndexTaskPriority::Background);
    assert_eq!(task.reason, "full-refresh-deep:refresh-workspace");
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
        refresh_result: Some(crate::models::workspace::WorkspaceIndexRefreshResult {
            state: crate::models::workspace::WorkspaceIndexState {
                status: crate::models::workspace::WorkspaceIndexStatus::Ready,
                root_path: Some("/workspace".to_string()),
                file_paths: vec!["A.ets".to_string()],
                symbols: Vec::new(),
                indexed_at: Some(200),
                partial_reason: None,
            },
            changed: true,
            added_paths: vec!["A.ets".to_string()],
            removed_paths: Vec::new(),
        }),
        refresh_continuation: Some(continuation),
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 2,
    };
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));

    let summary = schedule_refresh_continuations(&scheduler, &[result]).unwrap();
    let tasks = scheduler.lock().unwrap().pending_tasks();

    assert_eq!(summary.root_paths, vec!["/workspace"]);
    assert!(summary.superseded_tasks.is_empty());
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(tasks[0].priority, WorkspaceIndexTaskPriority::FullRefresh);
    assert_eq!(tasks[0].changed_paths, vec!["B.ets"]);
    assert_eq!(tasks[0].reason, "full-refresh-files:refresh-workspace");
    assert_eq!(tasks[1].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(tasks[1].priority, WorkspaceIndexTaskPriority::Background);
    assert_eq!(tasks[1].changed_paths, vec!["A.ets"]);
    assert_eq!(tasks[1].reason, "full-refresh-deep:refresh-workspace");
}

#[test]
fn schedules_deep_refresh_even_when_file_layer_has_no_remaining_chunks() {
    let result = WorkspaceIndexTaskResult {
        root_path: "/workspace".to_string(),
        kind: "refresh-workspace".to_string(),
        status: "ready".to_string(),
        reason: "refresh-workspace".to_string(),
        generation: 7,
        started_at: Some(100),
        finished_at: Some(200),
        message: None,
        error: None,
        refresh_result: Some(crate::models::workspace::WorkspaceIndexRefreshResult {
            state: crate::models::workspace::WorkspaceIndexState {
                status: crate::models::workspace::WorkspaceIndexStatus::Ready,
                root_path: Some("/workspace".to_string()),
                file_paths: vec!["A.ets".to_string()],
                symbols: Vec::new(),
                indexed_at: Some(200),
                partial_reason: None,
            },
            changed: true,
            added_paths: vec!["A.ets".to_string()],
            removed_paths: Vec::new(),
        }),
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    };
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));

    schedule_refresh_continuations(&scheduler, &[result]).unwrap();
    let tasks = scheduler.lock().unwrap().pending_tasks();

    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].priority, WorkspaceIndexTaskPriority::Background);
    assert_eq!(tasks[0].reason, "full-refresh-deep:refresh-workspace");
    assert_eq!(tasks[0].changed_paths, vec!["A.ets"]);
}
