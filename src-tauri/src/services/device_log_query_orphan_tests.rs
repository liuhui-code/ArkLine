use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::device_log_query::DeviceLogQueryRequest;
use crate::services::device_log_metadata_service::{
    DeviceLogMetadataBatch, DeviceLogMetadataStore,
};
use crate::services::device_log_query_service::query_device_log_buffer;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn query_skips_missing_segment_and_removes_orphan_metadata() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let segment_path = temp.join("stream-1.logseg");
    fs::write(&segment_path, "lost log\n").expect("segment");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: 1,
            segment_file: "stream-1.logseg".to_string(),
            segment_offset: 0,
            segment_bytes: "lost log\n".len() as u64,
            levels: vec!["info".to_string()],
        })
        .expect("insert");
    fs::remove_file(&segment_path).expect("remove segment");

    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "lost".to_string();
    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert!(response.rows.is_empty());
    assert_eq!(metadata.storage_summary().expect("summary").batch_count, 0);
    fs::remove_dir_all(temp).expect("cleanup");
}

#[test]
fn query_skips_truncated_segment_and_removes_stale_metadata() {
    let temp = unique_temp_dir();
    fs::create_dir_all(&temp).expect("tempdir");
    let segment_path = temp.join("stream-1.logseg");
    fs::write(&segment_path, "short\n").expect("segment");
    let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
    metadata
        .insert_batch(&DeviceLogMetadataBatch {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 70_000,
            line_count: 1,
            segment_file: "stream-1.logseg".to_string(),
            segment_offset: 0,
            segment_bytes: 64,
            levels: vec!["info".to_string()],
        })
        .expect("insert");

    let mut request = DeviceLogQueryRequest::recent("stream-1");
    request.query = "short".to_string();
    let response = query_device_log_buffer(&temp, &request, 70_001).expect("query");

    assert!(response.rows.is_empty());
    assert_eq!(metadata.storage_summary().expect("summary").batch_count, 0);
    fs::remove_dir_all(temp).expect("cleanup");
}

fn unique_temp_dir() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "arkline-device-log-query-orphan-{}-{nanos}-{counter}",
        std::process::id(),
    ))
}
