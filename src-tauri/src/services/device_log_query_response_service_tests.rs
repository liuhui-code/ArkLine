use std::time::Instant;

use crate::models::device_log_query::DeviceLogQueryStopReason;
use crate::services::device_log_query_response_service::response_from_matches;

#[test]
fn budget_stopped_response_exposes_continuation_diagnostics() {
    let response = response_from_matches(
        Vec::new(),
        500,
        42,
        12,
        Some(88),
        DeviceLogQueryStopReason::ScanBudget,
        Instant::now(),
    );

    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::ScanBudget);
    assert_eq!(response.next_cursor_seq, Some(88));
    assert_eq!(response.continuation_cursor_seq, Some(88));
    assert_eq!(response.continuation_reason, "scanBudget");
}

#[test]
fn complete_response_has_no_continuation_diagnostics() {
    let response = response_from_matches(
        Vec::new(),
        500,
        42,
        12,
        Some(88),
        DeviceLogQueryStopReason::Complete,
        Instant::now(),
    );

    assert_eq!(response.next_cursor_seq, None);
    assert_eq!(response.continuation_cursor_seq, None);
    assert_eq!(response.continuation_reason, "none");
}
