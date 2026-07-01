use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_readiness_service::readiness_for_query;

#[test]
fn current_generation_is_ready() {
    let readiness = readiness_for_query("/workspace", 7, Some(7), None);

    assert_eq!(readiness.state, WorkspaceIndexReadinessState::Ready);
    assert_eq!(readiness.root_path, "/workspace");
    assert_eq!(readiness.requested_generation, 7);
    assert_eq!(readiness.served_generation, Some(7));
    assert_eq!(readiness.reason, None);
    assert!(!readiness.retryable);
}

#[test]
fn older_generation_is_stale_and_retryable() {
    let readiness = readiness_for_query("/workspace", 9, Some(4), None);

    assert_eq!(readiness.state, WorkspaceIndexReadinessState::Stale);
    assert_eq!(readiness.served_generation, Some(4));
    assert_eq!(
        readiness.reason.as_deref(),
        Some("Served generation 4 is older than requested generation 9")
    );
    assert!(readiness.retryable);
}

#[test]
fn partial_reason_takes_priority_over_generation_match() {
    let readiness = readiness_for_query("/workspace", 5, Some(5), Some("scan truncated"));

    assert_eq!(readiness.state, WorkspaceIndexReadinessState::Partial);
    assert_eq!(readiness.reason.as_deref(), Some("scan truncated"));
    assert!(readiness.retryable);
}

#[test]
fn missing_generation_is_missing_and_retryable() {
    let readiness = readiness_for_query("/workspace", 1, None, None);

    assert_eq!(readiness.state, WorkspaceIndexReadinessState::Missing);
    assert_eq!(readiness.served_generation, None);
    assert_eq!(
        readiness.reason.as_deref(),
        Some("No indexed generation is available")
    );
    assert!(readiness.retryable);
}
