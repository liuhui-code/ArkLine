use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::models::device_log::{DeviceLogDevice, DeviceLogOutputBatch, DeviceLogStreamSummary, StartDeviceLogStreamRequest};
use tauri::{AppHandle, Emitter};

pub struct DeviceLogRuntime {
    streams: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    next_id: AtomicU64,
}

impl Default for DeviceLogRuntime {
    fn default() -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
        }
    }
}

pub fn list_devices() -> Result<Vec<DeviceLogDevice>, String> {
    let output = Command::new(resolve_hdc_path())
        .args(["list", "targets", "-v"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to run hdc: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");

    Ok(parse_hdc_targets(&combined))
}

pub fn parse_hdc_targets(output: &str) -> Vec<DeviceLogDevice> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.contains("Connect server failed") {
                return None;
            }

            let mut parts = trimmed.split_whitespace();
            let id = parts.next()?.to_string();
            let status_text = parts.next().unwrap_or("unknown");
            let status = match status_text.to_ascii_lowercase().as_str() {
                "connected" | "online" => "online",
                "offline" => "offline",
                "unauthorized" => "unauthorized",
                _ => "unknown",
            };

            Some(DeviceLogDevice {
                label: id.clone(),
                id,
                status: status.to_string(),
                detail: trimmed.to_string(),
            })
        })
        .collect()
}

pub fn start_stream(
    app: AppHandle,
    runtime: &DeviceLogRuntime,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    let stream_number = runtime.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let stream_id = format!("device-log-{stream_number}");
    let mut child = Command::new(resolve_hdc_path())
        .args(["-t", &request.device_id, "hilog"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start hdc hilog: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture hdc hilog stdout".to_string())?;
    let stream_id_for_thread = stream_id.clone();
    let device_id_for_thread = request.device_id.clone();
    let app_for_thread = app.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut batch: Vec<String> = Vec::new();

        for line in reader.lines().map_while(Result::ok) {
            batch.push(line);
            if batch.len() >= 50 {
                let _ = app_for_thread.emit(
                    "device-log-output",
                    DeviceLogOutputBatch {
                        stream_id: stream_id_for_thread.clone(),
                        device_id: device_id_for_thread.clone(),
                        lines: std::mem::take(&mut batch),
                    },
                );
            }
        }

        if !batch.is_empty() {
            let _ = app_for_thread.emit(
                "device-log-output",
                DeviceLogOutputBatch {
                    stream_id: stream_id_for_thread,
                    device_id: device_id_for_thread,
                    lines: batch,
                },
            );
        }
    });

    runtime
        .streams
        .lock()
        .expect("device log stream lock")
        .insert(stream_id.clone(), Arc::new(Mutex::new(child)));

    Ok(DeviceLogStreamSummary {
        stream_id,
        device_id: request.device_id,
        status: "running".to_string(),
    })
}

pub fn stop_stream(runtime: &DeviceLogRuntime, stream_id: &str) -> Result<(), String> {
    let child = runtime
        .streams
        .lock()
        .expect("device log stream lock")
        .remove(stream_id);

    if let Some(child) = child {
        child
            .lock()
            .expect("device log child lock")
            .kill()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_hdc_path() -> String {
    "hdc".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hdc_targets_verbose_output() {
        let devices = parse_hdc_targets("127.0.0.1:5555\tConnected\nUSB123\tOffline\n");

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].id, "127.0.0.1:5555");
        assert_eq!(devices[0].status, "online");
        assert_eq!(devices[1].status, "offline");
    }

    #[test]
    fn normalizes_failed_server_output_to_unknown_device_list() {
        let devices = parse_hdc_targets("Connect server failed\n");

        assert!(devices.is_empty());
    }
}
