use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_state_machine_service::{
    should_publish_task_result, task_state_label, transition_task_state, WorkspaceIndexTaskState,
};
use crate::services::workspace_index_task_status_service::{
    task_status_from_result_transition, task_status_from_state_transition, WorkspaceIndexTaskResult,
};

#[test]
fn state_machine_allows_normal_task_lifecycle_transitions() {
    assert_eq!(
        transition_task_state(
            WorkspaceIndexTaskState::Queued,
            WorkspaceIndexTaskState::Running
        ),
        Ok(WorkspaceIndexTaskState::Running)
    );
    assert_eq!(
        transition_task_state(
            WorkspaceIndexTaskState::Running,
            WorkspaceIndexTaskState::Ready
        ),
        Ok(WorkspaceIndexTaskState::Ready)
    );
}

#[test]
fn state_machine_allows_cancellation_and_superseding_lifecycle() {
    assert_eq!(
        transition_task_state(
            WorkspaceIndexTaskState::Running,
            WorkspaceIndexTaskState::Cancelling
        ),
        Ok(WorkspaceIndexTaskState::Cancelling)
    );
    assert_eq!(
        transition_task_state(
            WorkspaceIndexTaskState::Cancelling,
            WorkspaceIndexTaskState::Cancelled
        ),
        Ok(WorkspaceIndexTaskState::Cancelled)
    );
    assert_eq!(
        transition_task_state(
            WorkspaceIndexTaskState::Queued,
            WorkspaceIndexTaskState::Superseded
        ),
        Ok(WorkspaceIndexTaskState::Superseded)
    );
}

#[test]
fn state_machine_rejects_terminal_state_mutation() {
    assert!(transition_task_state(
        WorkspaceIndexTaskState::Ready,
        WorkspaceIndexTaskState::Running
    )
    .is_err());
    assert!(transition_task_state(
        WorkspaceIndexTaskState::Superseded,
        WorkspaceIndexTaskState::Running
    )
    .is_err());
}

#[test]
fn state_machine_rejects_stale_generation_publication() {
    assert!(should_publish_task_result(4, 4));
    assert!(should_publish_task_result(5, 4));
    assert!(!should_publish_task_result(3, 4));
}

#[test]
fn state_machine_owns_task_status_labels() {
    assert_eq!(task_state_label(WorkspaceIndexTaskState::Queued), "queued");
    assert_eq!(
        task_state_label(WorkspaceIndexTaskState::Running),
        "running"
    );
    assert_eq!(
        task_state_label(WorkspaceIndexTaskState::Cancelling),
        "cancelling"
    );
    assert_eq!(
        task_state_label(WorkspaceIndexTaskState::Cancelled),
        "cancelled"
    );
    assert_eq!(task_state_label(WorkspaceIndexTaskState::Ready), "ready");
    assert_eq!(
        task_state_label(WorkspaceIndexTaskState::Partial),
        "partial"
    );
    assert_eq!(task_state_label(WorkspaceIndexTaskState::Failed), "failed");
    assert_eq!(
        task_state_label(WorkspaceIndexTaskState::Superseded),
        "superseded"
    );
}

#[test]
fn state_machine_guards_task_status_publication_transitions() {
    let task = WorkspaceIndexTask {
        root_path: "/workspace".to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: Some("/sdk".to_string()),
        sdk_version: Some("test-sdk".to_string()),
        generation: 9,
        reason: "sdk-apply".to_string(),
    };

    let running = task_status_from_state_transition(
        &task,
        WorkspaceIndexTaskState::Queued,
        WorkspaceIndexTaskState::Running,
        None,
        None,
    )
    .expect("queued task should be publishable as running");

    assert_eq!(running.kind, "sdk");
    assert_eq!(running.status, "running");
    assert_eq!(running.generation, 9);
    assert!(task_status_from_state_transition(
        &task,
        WorkspaceIndexTaskState::Ready,
        WorkspaceIndexTaskState::Running,
        None,
        None,
    )
    .is_err());
}

#[test]
fn discovery_task_running_status_uses_discovery_kind() {
    let task = WorkspaceIndexTask {
        root_path: "/workspace".to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::VisibleFiles,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 10,
        reason: "workspace-discovery".to_string(),
    };

    let running = task_status_from_state_transition(
        &task,
        WorkspaceIndexTaskState::Queued,
        WorkspaceIndexTaskState::Running,
        None,
        None,
    )
    .expect("discovery task should publish running status");

    assert_eq!(running.kind, "discovery");
    assert_eq!(running.status, "running");
}

#[test]
fn state_machine_guards_result_status_publication_transitions() {
    let result = WorkspaceIndexTaskResult {
        root_path: "/workspace".to_string(),
        kind: "sdk".to_string(),
        status: "ready".to_string(),
        reason: "sdk-apply".to_string(),
        generation: 10,
        started_at: Some(100),
        finished_at: Some(200),
        message: None,
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_symbol_count: Some(42),
        progress_current: 2,
        progress_total: 3,
    };

    let ready = task_status_from_result_transition(&result, WorkspaceIndexTaskState::Running)
        .expect("running task result should publish ready status");

    assert_eq!(ready.kind, "sdk");
    assert_eq!(ready.status, "ready");
    assert_eq!(ready.generation, 10);
    assert_eq!(ready.symbol_count, Some(42));
    assert_eq!(ready.progress_current, 2);
    assert_eq!(ready.progress_total, 3);
    assert!(task_status_from_result_transition(&result, WorkspaceIndexTaskState::Queued).is_err());
}

#[test]
fn state_machine_keeps_skipped_as_a_compatibility_result_status() {
    let result = WorkspaceIndexTaskResult {
        root_path: "/workspace".to_string(),
        kind: "changed-paths".to_string(),
        status: "skipped".to_string(),
        reason: "watcher".to_string(),
        generation: 11,
        started_at: Some(100),
        finished_at: Some(200),
        message: Some("No changed paths require reindexing".to_string()),
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    };

    let error = task_status_from_result_transition(&result, WorkspaceIndexTaskState::Running)
        .expect_err("skipped remains outside the core lifecycle state machine");

    assert!(error.contains("Unsupported workspace index task result status: skipped"));
}
