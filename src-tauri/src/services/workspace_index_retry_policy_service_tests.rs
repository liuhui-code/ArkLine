use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_retry_policy_service::retry_backoff_for_failed_statuses;

#[test]
fn retry_backoff_starts_after_second_consecutive_failure() {
    let first = status(1, "failed");
    let second = status(2, "failed");

    assert!(retry_backoff_for_failed_statuses(&first, &[first.clone()]).is_none());

    let backoff = retry_backoff_for_failed_statuses(&second, &[first, second.clone()]).unwrap();

    assert_eq!(backoff.failure_count, 2);
    assert_eq!(backoff.retry_after_ms, 2_000);
    assert!(!backoff.exhausted);
}

#[test]
fn retry_backoff_resets_after_success_or_different_task_reason() {
    let first = status(1, "failed");
    let ready = status(2, "ready");
    let second = status(3, "failed");
    let other_reason = status_with_reason(4, "failed", "manual");

    assert!(retry_backoff_for_failed_statuses(&second, &[first, ready, second.clone()]).is_none());
    assert!(
        retry_backoff_for_failed_statuses(&other_reason, &[second, other_reason.clone()]).is_none()
    );
}

#[test]
fn retry_backoff_caps_delay_and_reports_exhaustion() {
    let statuses = (1..=7)
        .map(|generation| status(generation, "failed"))
        .collect::<Vec<_>>();
    let backoff = retry_backoff_for_failed_statuses(statuses.last().unwrap(), &statuses).unwrap();

    assert_eq!(backoff.failure_count, 7);
    assert_eq!(backoff.retry_after_ms, 30_000);
    assert!(backoff.exhausted);
}

fn status(generation: u64, state: &str) -> WorkspaceIndexTaskStatus {
    status_with_reason(generation, state, "watcher")
}

fn status_with_reason(generation: u64, state: &str, reason: &str) -> WorkspaceIndexTaskStatus {
    WorkspaceIndexTaskStatus {
        task_id: format!("{generation}:changed-paths"),
        root_path: "root".to_string(),
        kind: "changed-paths".to_string(),
        status: state.to_string(),
        reason: reason.to_string(),
        generation,
        progress_current: 1,
        progress_total: 1,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(generation as u128),
        last_heartbeat_at: Some(generation as u128),
        stalled: false,
        finished_at: Some(generation as u128),
        symbol_count: None,
        message: None,
        error: (state == "failed").then_some("index failed".to_string()),
    }
}
