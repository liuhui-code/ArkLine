use std::path::Path;

use tauri::{AppHandle, State};

use crate::models::device_log::{
    DeviceFaultLogFetchResult, DeviceLogDevice, DeviceLogStreamSummary, ListDeviceFaultLogsRequest,
    StartDeviceLogStreamRequest,
};
use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryWorkerEvent,
    DeviceLogQueryWorkerStats, DeviceLogRetentionApplyResult, DeviceLogRetentionPlan,
    DeviceLogRuntimeStats, DeviceLogStorageClearResult, DeviceLogStorageHealth,
};
use crate::services::device_fault_log_service::list_fault_logs;
use crate::services::device_log_export_service::{
    export_query_pages_as_text, export_query_pages_to_file,
};
use crate::services::device_log_hdc_service::list_devices;
use crate::services::device_log_service::DeviceLogRuntime;
use crate::services::device_log_stream_lifecycle_service::{start_stream, stop_stream};

#[tauri::command]
pub fn list_device_log_devices() -> Result<Vec<DeviceLogDevice>, String> {
    list_devices()
}

#[tauri::command]
pub fn list_device_fault_logs(
    request: ListDeviceFaultLogsRequest,
) -> Result<DeviceFaultLogFetchResult, String> {
    list_fault_logs(request)
}

#[tauri::command]
pub fn start_device_log_stream(
    app: AppHandle,
    runtime: State<DeviceLogRuntime>,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    start_stream(app, runtime.inner(), request)
}

#[tauri::command]
pub fn stop_device_log_stream(
    runtime: State<DeviceLogRuntime>,
    stream_id: String,
) -> Result<(), String> {
    stop_stream(runtime.inner(), &stream_id)
}

#[tauri::command]
pub fn query_device_logs(
    runtime: State<DeviceLogRuntime>,
    request: DeviceLogQueryRequest,
) -> Result<DeviceLogQueryResponse, String> {
    runtime.query_latest_logs(&request)
}

#[tauri::command]
pub fn export_device_logs(
    runtime: State<DeviceLogRuntime>,
    request: DeviceLogQueryRequest,
) -> Result<String, String> {
    export_query_pages_as_text(request, |page_request| runtime.query_logs(page_request))
}

#[tauri::command]
pub fn export_device_logs_to_file(
    runtime: State<DeviceLogRuntime>,
    request: DeviceLogQueryRequest,
    path: String,
) -> Result<(), String> {
    export_query_pages_to_file(request, Path::new(&path), |page_request| {
        runtime.query_logs(page_request)
    })
}

#[tauri::command]
pub fn get_device_log_stats(
    runtime: State<DeviceLogRuntime>,
    stream_id: String,
) -> Result<DeviceLogRuntimeStats, String> {
    Ok(runtime
        .stats_for(&stream_id)
        .unwrap_or_else(|| DeviceLogRuntimeStats {
            stream_id,
            ..DeviceLogRuntimeStats::default()
        }))
}

#[tauri::command]
pub fn get_device_log_query_worker_stats(
    runtime: State<DeviceLogRuntime>,
) -> Result<DeviceLogQueryWorkerStats, String> {
    Ok(runtime.query_worker_stats())
}

#[tauri::command]
pub fn get_device_log_query_worker_events(
    runtime: State<DeviceLogRuntime>,
) -> Result<Vec<DeviceLogQueryWorkerEvent>, String> {
    Ok(runtime.query_worker_events())
}

#[tauri::command]
pub fn get_device_log_storage_health(
    runtime: State<DeviceLogRuntime>,
) -> Result<DeviceLogStorageHealth, String> {
    runtime.storage_health()
}

#[tauri::command]
pub fn clear_device_log_storage(
    runtime: State<DeviceLogRuntime>,
) -> Result<DeviceLogStorageClearResult, String> {
    runtime.clear_storage()
}

#[tauri::command]
pub fn plan_device_log_retention(
    runtime: State<DeviceLogRuntime>,
    target_bytes: u64,
) -> Result<DeviceLogRetentionPlan, String> {
    runtime.retention_plan(target_bytes)
}

#[tauri::command]
pub fn apply_device_log_retention(
    runtime: State<DeviceLogRuntime>,
    target_bytes: u64,
) -> Result<DeviceLogRetentionApplyResult, String> {
    runtime.apply_retention(target_bytes)
}
