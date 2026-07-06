use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryRow, DeviceLogQueryStopReason,
};
use crate::services::device_log_query_service::filter_rows_with_cancel;

#[test]
fn query_stops_when_latest_request_supersedes_it() {
    let rows = (1..=100)
        .rev()
        .map(|seq| make_row(seq, "background noise"))
        .collect::<Vec<_>>();
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "missing".to_string();
    request.scan_budget_lines = None;
    let mut checks = 0_usize;

    let response = filter_rows_with_cancel(rows, &request, 70_001, &mut || {
        checks += 1;
        checks > 3
    })
    .expect("response");

    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::Cancelled);
    assert!(response.scanned_lines < 100);
    assert_eq!(response.continuation_reason, "cancelled");
}

fn make_row(seq: u64, message: &str) -> DeviceLogQueryRow {
    DeviceLogQueryRow {
        seq,
        received_at_ms: 70_000,
        raw: message.to_string(),
        timestamp: None,
        level: "info".to_string(),
        pid: Some(1),
        tid: Some(2),
        process: "demo".to_string(),
        domain: "C03F00".to_string(),
        tag: "AppTag".to_string(),
        message: message.to_string(),
    }
}
