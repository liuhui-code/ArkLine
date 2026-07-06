use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogRetentionApplyResult,
    DeviceLogRetentionPlan, DeviceLogStorageClearResult, DeviceLogStorageHealth,
};
use crate::services::device_log_metadata_service::DeviceLogMetadataStore;
use crate::services::device_log_query_service::{
    query_device_log_buffer, query_device_log_buffer_cancellable,
};
use crate::services::device_log_retention_service::{
    apply_device_log_storage_retention, plan_device_log_storage_retention,
};
use crate::services::device_log_runtime_service::DeviceLogRuntimeState;
use crate::services::device_log_segment_service::DeviceLogSegmentWriter;
use crate::services::device_log_storage_health_service::{
    clear_device_log_storage, inspect_device_log_storage,
};
use crate::services::device_log_stream_service::DeviceLogBatchSink;
use crate::services::device_log_writer_worker_service::{
    DeviceLogWriterWorkerSink, DurableDeviceLogBatchSink,
};

const WRITER_QUEUE_CAPACITY: usize = 256;

pub fn create_stream_sink(
    stats: Arc<DeviceLogRuntimeState>,
    stream_id: &str,
) -> Result<Arc<dyn DeviceLogBatchSink>, String> {
    let root = device_log_buffer_root();
    let writer = DeviceLogSegmentWriter::open(&root, stream_id)?;
    let metadata = DeviceLogMetadataStore::open(&root)?;
    let durable = DurableDeviceLogBatchSink::new(writer, metadata, stats);
    Ok(Arc::new(DeviceLogWriterWorkerSink::new(
        durable,
        WRITER_QUEUE_CAPACITY,
    )))
}

pub fn query_persisted_device_logs(
    request: &DeviceLogQueryRequest,
) -> Result<DeviceLogQueryResponse, String> {
    query_device_log_buffer(&device_log_buffer_root(), request, current_time_ms())
}

pub fn query_persisted_device_logs_cancellable(
    request: &DeviceLogQueryRequest,
    should_cancel: &mut dyn FnMut() -> bool,
) -> Result<DeviceLogQueryResponse, String> {
    query_device_log_buffer_cancellable(
        &device_log_buffer_root(),
        request,
        current_time_ms(),
        should_cancel,
    )
}

pub fn inspect_persisted_device_log_storage() -> Result<DeviceLogStorageHealth, String> {
    inspect_device_log_storage(&device_log_buffer_root())
}

pub fn clear_persisted_device_log_storage() -> Result<DeviceLogStorageClearResult, String> {
    clear_device_log_storage(&device_log_buffer_root())
}

pub fn plan_persisted_device_log_retention(
    target_bytes: u64,
) -> Result<DeviceLogRetentionPlan, String> {
    plan_device_log_storage_retention(&device_log_buffer_root(), target_bytes)
}

pub fn apply_persisted_device_log_retention(
    target_bytes: u64,
) -> Result<DeviceLogRetentionApplyResult, String> {
    apply_device_log_storage_retention(&device_log_buffer_root(), target_bytes)
}

fn device_log_buffer_root() -> PathBuf {
    std::env::temp_dir().join("arkline-device-logs")
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
