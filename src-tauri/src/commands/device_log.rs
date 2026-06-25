use tauri::State;

use crate::models::device_log::{DeviceLogDevice, DeviceLogStreamSummary, StartDeviceLogStreamRequest};
use crate::services::device_log_service::{list_devices, start_stream, stop_stream, DeviceLogRuntime};

#[tauri::command]
pub fn list_device_log_devices() -> Result<Vec<DeviceLogDevice>, String> {
    list_devices()
}

#[tauri::command]
pub fn start_device_log_stream(
    runtime: State<DeviceLogRuntime>,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    start_stream(runtime.inner(), request)
}

#[tauri::command]
pub fn stop_device_log_stream(runtime: State<DeviceLogRuntime>, stream_id: String) -> Result<(), String> {
    stop_stream(runtime.inner(), &stream_id)
}
