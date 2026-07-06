use std::time::Instant;

use crate::models::device_log_query::{
    DeviceLogQueryResponse, DeviceLogQueryRow, DeviceLogQueryStopReason,
};

pub(crate) fn response_from_matches(
    mut matched: Vec<DeviceLogQueryRow>,
    limit: usize,
    total_candidates: usize,
    scanned_lines: usize,
    last_scanned_seq: Option<u64>,
    stop_reason: DeviceLogQueryStopReason,
    started: Instant,
) -> DeviceLogQueryResponse {
    matched.sort_by_key(|row| row.seq);
    let next_cursor_seq = if matched.len() >= limit {
        matched.first().map(|row| row.seq)
    } else if matches!(
        stop_reason,
        DeviceLogQueryStopReason::ScanBudget | DeviceLogQueryStopReason::Deadline
    ) {
        last_scanned_seq
    } else {
        None
    };
    let budget_exceeded = matches!(
        stop_reason,
        DeviceLogQueryStopReason::ScanBudget | DeviceLogQueryStopReason::Deadline
    );
    let continuation_cursor_seq = next_cursor_seq;
    let continuation_reason = continuation_reason(&stop_reason, continuation_cursor_seq);

    DeviceLogQueryResponse {
        truncated: stop_reason == DeviceLogQueryStopReason::Limit,
        rows: matched,
        total_candidates,
        scanned_lines,
        next_cursor_seq,
        continuation_cursor_seq,
        continuation_reason,
        budget_exceeded,
        stop_reason,
        query_ms: started.elapsed().as_millis() as u64,
    }
}

fn continuation_reason(
    stop_reason: &DeviceLogQueryStopReason,
    continuation_cursor_seq: Option<u64>,
) -> String {
    if continuation_cursor_seq.is_none() {
        if *stop_reason == DeviceLogQueryStopReason::Cancelled {
            return "cancelled".to_string();
        }
        return "none".to_string();
    }
    match stop_reason {
        DeviceLogQueryStopReason::Limit => "limit",
        DeviceLogQueryStopReason::ScanBudget => "scanBudget",
        DeviceLogQueryStopReason::Deadline => "deadline",
        DeviceLogQueryStopReason::Cancelled => "cancelled",
        DeviceLogQueryStopReason::Complete => "none",
    }
    .to_string()
}
