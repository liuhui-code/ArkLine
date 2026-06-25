use tauri::{AppHandle, State};

use crate::models::device_log::{
    DeviceFaultLogFetchResult, DeviceLogDevice, DeviceLogStreamSummary, ListDeviceFaultLogsRequest, StartDeviceLogStreamRequest,
};
use crate::services::device_log_service::{list_devices, list_fault_logs, start_stream, stop_stream, DeviceLogRuntime};

#[tauri::command]
pub fn list_device_log_devices() -> Result<Vec<DeviceLogDevice>, String> {
    list_devices()
}

#[tauri::command]
pub fn list_device_fault_logs(request: ListDeviceFaultLogsRequest) -> Result<DeviceFaultLogFetchResult, String> {
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
pub fn stop_device_log_stream(runtime: State<DeviceLogRuntime>, stream_id: String) -> Result<(), String> {
    stop_stream(runtime.inner(), &stream_id)
}
