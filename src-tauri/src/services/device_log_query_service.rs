use std::path::Path;
use std::time::{Duration, Instant};

use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryRow, DeviceLogQueryStopReason,
};
use crate::services::device_log_metadata_service::{DeviceLogMetadataRow, DeviceLogMetadataStore};
use crate::services::device_log_query_deadline_service::DeviceLogQueryDeadline;
use crate::services::device_log_query_limit_service::normalize_query_limit;
use crate::services::device_log_query_matcher_service::{
    build_matcher, matches_page_scope, matches_structured_filters, matches_text,
    DeviceLogTextMatcher,
};
use crate::services::device_log_query_parser_service::parse_query_row;
use crate::services::device_log_query_pruning_service::batch_excluded_by_metadata;
use crate::services::device_log_query_response_service::response_from_matches;
use crate::services::device_log_query_time_service::normalize_query_time_range;
use crate::services::device_log_segment_service::{
    read_segment_file_lines, segment_file_exists, DeviceLogSegmentReadError,
};

const QUERY_BATCH_PAGE_SIZE: usize = 64;
const QUERY_SOFT_DEADLINE_MS: u64 = 120;

pub fn query_device_log_buffer(
    root: &Path,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
) -> Result<DeviceLogQueryResponse, String> {
    let started = Instant::now();
    query_device_log_buffer_with_deadline(
        root,
        request,
        now_ms,
        started,
        Duration::from_millis(QUERY_SOFT_DEADLINE_MS),
    )
}

pub fn query_device_log_buffer_cancellable(
    root: &Path,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    should_cancel: &mut dyn FnMut() -> bool,
) -> Result<DeviceLogQueryResponse, String> {
    let started = Instant::now();
    query_device_log_buffer_with_deadline_inner(
        root,
        request,
        now_ms,
        started,
        Duration::from_millis(QUERY_SOFT_DEADLINE_MS),
        Some(should_cancel),
    )
}

#[cfg(test)]
pub fn query_device_log_buffer_with_deadline(
    root: &Path,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    started: Instant,
    deadline_budget: Duration,
) -> Result<DeviceLogQueryResponse, String> {
    query_device_log_buffer_with_deadline_inner(
        root,
        request,
        now_ms,
        started,
        deadline_budget,
        None,
    )
}

#[cfg(not(test))]
fn query_device_log_buffer_with_deadline(
    root: &Path,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    started: Instant,
    deadline_budget: Duration,
) -> Result<DeviceLogQueryResponse, String> {
    query_device_log_buffer_with_deadline_inner(
        root,
        request,
        now_ms,
        started,
        deadline_budget,
        None,
    )
}

fn query_device_log_buffer_with_deadline_inner(
    root: &Path,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    started: Instant,
    deadline_budget: Duration,
    mut should_cancel: Option<&mut dyn FnMut() -> bool>,
) -> Result<DeviceLogQueryResponse, String> {
    let deadline = DeviceLogQueryDeadline::new(started, deadline_budget);
    let metadata = DeviceLogMetadataStore::open(root)?;
    let time_range = normalize_query_time_range(now_ms, request.time_range_ms);
    let matcher = build_matcher(request)?;
    let limit = normalize_query_limit(request.limit);
    let mut offset = 0_usize;
    let mut total_candidates = 0_usize;
    let mut scanned_lines = 0_usize;
    let mut last_scanned_seq = None;
    let mut stop_reason = DeviceLogQueryStopReason::Complete;
    let mut matched = Vec::new();
    let mut orphan_segments = Vec::new();

    loop {
        if query_cancelled(&mut should_cancel) {
            stop_reason = DeviceLogQueryStopReason::Cancelled;
            break;
        }
        let batches = metadata.query_range_page(
            &request.stream_id,
            time_range.start_ms,
            time_range.end_ms,
            QUERY_BATCH_PAGE_SIZE,
            offset,
        )?;
        if batches.is_empty() {
            break;
        }
        offset += batches.len();
        for batch in batches {
            if batch_excluded_by_metadata(&batch, request) {
                continue;
            }
            if !segment_file_exists(root, &batch.segment_file) {
                orphan_segments.push(batch.segment_file);
                continue;
            }
            let lines = match read_segment_file_lines(
                root,
                &batch.segment_file,
                batch.segment_offset,
                batch.segment_bytes,
            ) {
                Ok(lines) => lines,
                Err(DeviceLogSegmentReadError::StaleSegment(_)) => {
                    orphan_segments.push(batch.segment_file.clone());
                    continue;
                }
                Err(DeviceLogSegmentReadError::Fatal(message)) => return Err(message),
            };
            total_candidates += lines.len();
            if let Some(reason) = scan_batch_lines(
                batch,
                lines,
                request,
                &matcher,
                &mut scanned_lines,
                &mut last_scanned_seq,
                &mut matched,
                Some(&deadline),
                &mut should_cancel,
            ) {
                stop_reason = reason;
                break;
            }
            if matched.len() >= limit {
                stop_reason = DeviceLogQueryStopReason::Limit;
                break;
            }
        }
        if stop_reason != DeviceLogQueryStopReason::Complete {
            break;
        }
    }

    if !orphan_segments.is_empty() {
        orphan_segments.sort();
        orphan_segments.dedup();
        metadata.delete_batches_for_segment_files(&orphan_segments)?;
    }

    Ok(response_from_matches(
        matched,
        limit,
        total_candidates,
        scanned_lines,
        last_scanned_seq,
        stop_reason,
        started,
    ))
}

#[cfg(test)]
pub fn filter_rows(
    rows: Vec<DeviceLogQueryRow>,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
) -> Result<DeviceLogQueryResponse, String> {
    filter_rows_inner(rows, request, now_ms, None)
}

#[cfg(test)]
pub fn filter_rows_with_cancel(
    rows: Vec<DeviceLogQueryRow>,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    should_cancel: &mut dyn FnMut() -> bool,
) -> Result<DeviceLogQueryResponse, String> {
    filter_rows_inner(rows, request, now_ms, Some(should_cancel))
}

#[cfg(test)]
fn filter_rows_inner(
    rows: Vec<DeviceLogQueryRow>,
    request: &DeviceLogQueryRequest,
    now_ms: u64,
    mut should_cancel: Option<&mut dyn FnMut() -> bool>,
) -> Result<DeviceLogQueryResponse, String> {
    let started = Instant::now();
    let time_range = normalize_query_time_range(now_ms, request.time_range_ms);
    let matcher = build_matcher(request)?;
    let limit = normalize_query_limit(request.limit);
    let total_candidates = rows.len();
    let mut scanned_lines = 0_usize;
    let mut last_scanned_seq = None;
    let mut stop_reason = DeviceLogQueryStopReason::Complete;
    let mut matched = Vec::new();

    for row in rows {
        if query_cancelled(&mut should_cancel) {
            stop_reason = DeviceLogQueryStopReason::Cancelled;
            break;
        }
        if row.received_at_ms < time_range.start_ms || row.received_at_ms > time_range.end_ms {
            continue;
        }
        if let Some(cursor_seq) = request.cursor_seq {
            if row.seq >= cursor_seq {
                continue;
            }
        }
        if !matches_structured_filters(&row, request) {
            continue;
        }
        scanned_lines += 1;
        last_scanned_seq = Some(row.seq);
        if !matches_text(&row, &matcher) {
            if budget_reached(request, scanned_lines) {
                stop_reason = DeviceLogQueryStopReason::ScanBudget;
                break;
            }
            if DeviceLogQueryDeadline::new(started, Duration::from_millis(QUERY_SOFT_DEADLINE_MS))
                .expired()
            {
                stop_reason = DeviceLogQueryStopReason::Deadline;
                break;
            }
            continue;
        }
        matched.push(row);
        if matched.len() >= limit {
            stop_reason = DeviceLogQueryStopReason::Limit;
            break;
        }
        if budget_reached(request, scanned_lines) {
            stop_reason = DeviceLogQueryStopReason::ScanBudget;
            break;
        }
        if DeviceLogQueryDeadline::new(started, Duration::from_millis(QUERY_SOFT_DEADLINE_MS))
            .expired()
        {
            stop_reason = DeviceLogQueryStopReason::Deadline;
            break;
        }
    }

    Ok(response_from_matches(
        matched,
        limit,
        total_candidates,
        scanned_lines,
        last_scanned_seq,
        stop_reason,
        started,
    ))
}

fn scan_batch_lines(
    batch: DeviceLogMetadataRow,
    lines: Vec<String>,
    request: &DeviceLogQueryRequest,
    matcher: &DeviceLogTextMatcher,
    scanned_lines: &mut usize,
    last_scanned_seq: &mut Option<u64>,
    matched: &mut Vec<DeviceLogQueryRow>,
    deadline: Option<&DeviceLogQueryDeadline>,
    should_cancel: &mut Option<&mut dyn FnMut() -> bool>,
) -> Option<DeviceLogQueryStopReason> {
    let limit = normalize_query_limit(request.limit);
    for (index, line) in lines.into_iter().enumerate().rev() {
        if query_cancelled(should_cancel) {
            return Some(DeviceLogQueryStopReason::Cancelled);
        }
        let row = parse_query_row(batch.first_seq + index as u64, batch.received_at_ms, &line);
        if !matches_page_scope(&row, request) || !matches_structured_filters(&row, request) {
            continue;
        }
        *scanned_lines += 1;
        *last_scanned_seq = Some(row.seq);
        if !matches_text(&row, matcher) {
            if budget_reached(request, *scanned_lines) {
                return Some(DeviceLogQueryStopReason::ScanBudget);
            }
            if deadline.is_some_and(|d| d.expired()) {
                return Some(DeviceLogQueryStopReason::Deadline);
            }
            continue;
        }
        matched.push(row);
        if matched.len() >= limit {
            break;
        }
        if budget_reached(request, *scanned_lines) {
            return Some(DeviceLogQueryStopReason::ScanBudget);
        }
        if deadline.is_some_and(|d| d.expired()) {
            return Some(DeviceLogQueryStopReason::Deadline);
        }
    }
    None
}

fn budget_reached(request: &DeviceLogQueryRequest, scanned_lines: usize) -> bool {
    request
        .scan_budget_lines
        .is_some_and(|budget| scanned_lines >= budget)
}

fn query_cancelled(should_cancel: &mut Option<&mut dyn FnMut() -> bool>) -> bool {
    match should_cancel {
        Some(check) => check(),
        None => false,
    }
}
