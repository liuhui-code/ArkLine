use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryRow, DeviceLogQueryStopReason,
};
use crate::services::device_log_metadata_service::{
    DeviceLogMetadataBatch, DeviceLogMetadataStore,
};
use crate::services::device_log_query_service::{
    filter_rows, query_device_log_buffer, query_device_log_buffer_with_deadline,
};
use crate::services::device_log_segment_service::DeviceLogSegmentWriter;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn query_matches_recent_regex_without_scanning_old_batches() {
    let rows = vec![
        make_row(1, 1_000, "old width log"),
        make_row(2, 70_000, "fresh width log"),
    ];
    let request = DeviceLogQueryRequest {
        stream_id: "stream-1".to_string(),
        query: "fresh.*log".to_string(),
        regex: true,
        match_case: false,
        levels: vec![],
        pid: String::new(),
        process: String::new(),
        domain: String::new(),
        tag: String::new(),
        time_range_ms: 60_000,
        limit: 100,
        cursor_seq: None,
        scan_budget_lines: None,
    };

    let response = filter_rows(rows, &request, 70_001).expect("response");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].message, "fresh width log");
}

#[test]
fn query_cursor_paginates_to_older_matching_rows() {
    let rows = vec![
        make_row(5, 70_000, "width five"),
        make_row(4, 70_000, "width four"),
        make_row(3, 70_000, "width three"),
        make_row(2, 70_000, "width two"),
        make_row(1, 70_000, "width one"),
    ];
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "width".to_string();
    request.limit = 2;

    let first_page = filter_rows(rows.clone(), &request, 70_001).expect("first page");
    request.cursor_seq = first_page.next_cursor_seq;
    let second_page = filter_rows(rows, &request, 70_001).expect("second page");

    assert_eq!(
        first_page
            .rows
            .iter()
            .map(|row| row.seq)
            .collect::<Vec<_>>(),
        vec![4, 5]
    );
    assert_eq!(first_page.next_cursor_seq, Some(4));
    assert_eq!(
        second_page
            .rows
            .iter()
            .map(|row| row.seq)
            .collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert_eq!(second_page.next_cursor_seq, Some(2));
}

#[test]
fn query_scan_budget_returns_cursor_without_full_window_scan() {
    let rows = vec![
        make_row(5, 70_000, "noise five"),
        make_row(4, 70_000, "noise four"),
        make_row(3, 70_000, "target three"),
        make_row(2, 70_000, "target two"),
        make_row(1, 70_000, "target one"),
    ];
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "target".to_string();
    request.limit = 2;
    request.scan_budget_lines = Some(2);

    let response = filter_rows(rows, &request, 70_001).expect("response");

    assert!(response.rows.is_empty());
    assert_eq!(response.scanned_lines, 2);
    assert!(response.budget_exceeded);
    assert_eq!(response.next_cursor_seq, Some(4));
    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::ScanBudget);
}

fn make_row(seq: u64, received_at_ms: u64, message: &str) -> DeviceLogQueryRow {
    DeviceLogQueryRow {
        seq,
        received_at_ms,
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

#[test]
fn query_reads_persisted_segment_rows_with_regex() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let receipt = writer
        .append_lines(&[
            "06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: old width log"
                .to_string(),
            "06-25 15:21:49.123  1234  5678 E C03F00/AppTag com.example.demo: fresh width log"
                .to_string(),
        ])
        .expect("append");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: receipt.line_count,
            segment_file: receipt.segment_file,
            segment_offset: receipt.offset,
            segment_bytes: receipt.bytes,
            levels: vec!["info".to_string(), "error".to_string()],
        })
        .expect("metadata");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "fresh.*log".to_string();
    request.regex = true;

    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].level, "error");
    assert_eq!(response.rows[0].message, "fresh width log");
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_clamps_extreme_time_range_to_sqlite_domain() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let receipt = writer
        .append_lines(&["06-25 15:21:49.123  1234  5678 I C03F00/AppTag demo: target".into()])
        .expect("append");
    DeviceLogMetadataStore::open(&temp)
        .expect("metadata")
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: receipt.line_count,
            segment_file: receipt.segment_file,
            segment_offset: receipt.offset,
            segment_bytes: receipt.bytes,
            levels: vec!["info".to_string()],
        })
        .expect("metadata");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.time_range_ms = u64::MAX;

    let response = query_device_log_buffer(&temp, &request, u64::MAX).expect("query");

    assert_eq!(response.rows.len(), 1);
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_soft_deadline_returns_cursor_for_continuation() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let receipt = writer
        .append_lines(&[
            "06-25 15:21:48.123  1234  5678 I C03F00/AppTag demo: target one".to_string(),
            "06-25 15:21:49.123  1234  5678 I C03F00/AppTag demo: target two".to_string(),
        ])
        .expect("append");
    DeviceLogMetadataStore::open(&temp)
        .expect("metadata")
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: receipt.line_count,
            segment_file: receipt.segment_file,
            segment_offset: receipt.offset,
            segment_bytes: receipt.bytes,
            levels: vec!["info".to_string()],
        })
        .expect("metadata");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "target".to_string();
    request.limit = 500;

    let response = query_device_log_buffer_with_deadline(
        &temp,
        &request,
        70_001,
        Instant::now(),
        Duration::ZERO,
    )
    .expect("query");

    assert!(response.budget_exceeded);
    assert_eq!(response.scanned_lines, 1);
    assert_eq!(response.next_cursor_seq, Some(2));
    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::Deadline);
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_prunes_batches_that_cannot_match_level_filter() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
    let info_receipt = writer
        .append_lines(&[
            "06-25 15:21:50.123  1234  5678 I C03F00/AppTag demo: noisy info".to_string(),
        ])
        .expect("append info");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 2,
            received_at_ms: 70_000,
            line_count: info_receipt.line_count,
            segment_file: info_receipt.segment_file,
            segment_offset: info_receipt.offset,
            segment_bytes: info_receipt.bytes,
            levels: vec!["info".to_string()],
        })
        .expect("metadata info");
    let error_receipt = writer
        .append_lines(&[
            "06-25 15:21:49.123  1234  5678 E C03F00/AppTag demo: target error".to_string(),
        ])
        .expect("append error");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 69_000,
            line_count: error_receipt.line_count,
            segment_file: error_receipt.segment_file,
            segment_offset: error_receipt.offset,
            segment_bytes: error_receipt.bytes,
            levels: vec!["error".to_string()],
        })
        .expect("metadata error");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.levels = vec!["error".to_string()];
    request.query = "target".to_string();

    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert_eq!(response.total_candidates, 1);
    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].message, "target error");
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_prunes_batches_fully_newer_than_cursor() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
    let newer_receipt = writer
        .append_lines(&[
            "06-25 15:21:50.123  1234  5678 I C03F00/AppTag demo: newer one".to_string(),
            "06-25 15:21:51.123  1234  5678 I C03F00/AppTag demo: newer two".to_string(),
        ])
        .expect("append newer");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 10,
            received_at_ms: 70_000,
            line_count: newer_receipt.line_count,
            segment_file: newer_receipt.segment_file,
            segment_offset: newer_receipt.offset,
            segment_bytes: newer_receipt.bytes,
            levels: vec!["info".to_string()],
        })
        .expect("metadata newer");
    let older_receipt = writer
        .append_lines(&[
            "06-25 15:21:49.123  1234  5678 E C03F00/AppTag demo: older target".to_string(),
        ])
        .expect("append older");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 7,
            received_at_ms: 69_000,
            line_count: older_receipt.line_count,
            segment_file: older_receipt.segment_file,
            segment_offset: older_receipt.offset,
            segment_bytes: older_receipt.bytes,
            levels: vec!["error".to_string()],
        })
        .expect("metadata older");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "target".to_string();
    request.cursor_seq = Some(10);

    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert_eq!(response.total_candidates, 1);
    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].message, "older target");
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_limit_prefers_newest_matching_lines() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let receipt = writer
        .append_lines(&[
            "06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: old width log"
                .to_string(),
            "06-25 15:21:49.123  1234  5678 I C03F00/AppTag com.example.demo: newest width log"
                .to_string(),
        ])
        .expect("append");
    DeviceLogMetadataStore::open(&temp)
        .expect("metadata")
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: receipt.line_count,
            segment_file: receipt.segment_file,
            segment_offset: receipt.offset,
            segment_bytes: receipt.bytes,
            levels: vec!["info".to_string()],
        })
        .expect("metadata");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "width".to_string();
    request.limit = 1;

    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].message, "newest width log");
    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::Limit);
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_caps_oversized_requested_limit() {
    let rows = (1..=2_100)
        .rev()
        .map(|seq| make_row(seq, 70_000, &format!("target {seq}")))
        .collect::<Vec<_>>();
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "target".to_string();
    request.limit = usize::MAX;

    let response = filter_rows(rows, &request, 70_001).expect("response");

    assert_eq!(response.rows.len(), 2_000);
    assert_eq!(response.stop_reason, DeviceLogQueryStopReason::Limit);
    assert_eq!(response.next_cursor_seq, Some(101));
}

#[test]
fn query_scans_past_newer_non_matching_batches() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");

    for index in 0..70 {
        let receipt = writer
            .append_lines(&[format!(
                "06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: noise {index}"
            )])
            .expect("append noise");
        metadata
            .insert_batch(&DeviceLogMetadataBatch {
                stream_id: "stream-1".to_string(),
                device_id: "device-1".to_string(),
                first_seq: index + 2,
                received_at_ms: 70_000 + index,
                line_count: receipt.line_count,
                segment_file: receipt.segment_file,
                segment_offset: receipt.offset,
                segment_bytes: receipt.bytes,
                levels: vec!["info".to_string()],
            })
            .expect("metadata noise");
    }
    let receipt = writer
        .append_lines(&[
            "06-25 15:21:40.123  1234  5678 E C03F00/AppTag com.example.demo: rare target"
                .to_string(),
        ])
        .expect("append target");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 69_000,
            line_count: receipt.line_count,
            segment_file: receipt.segment_file,
            segment_offset: receipt.offset,
            segment_bytes: receipt.bytes,
            levels: vec!["error".to_string()],
        })
        .expect("metadata target");
    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "rare target".to_string();
    request.limit = 1;

    let response = query_device_log_buffer(&temp, &request, 70_100).expect("query");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(response.rows[0].message, "rare target");
    fs::remove_dir_all(temp).expect("cleanup");
}

fn unique_temp_dir() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "arkline-device-log-query-{}-{nanos}-{counter}",
        std::process::id(),
    ))
}
