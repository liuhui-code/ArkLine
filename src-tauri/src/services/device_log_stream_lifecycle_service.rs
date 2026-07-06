use std::io::ErrorKind;
use std::process::{Child, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::models::device_log::{DeviceLogStreamSummary, StartDeviceLogStreamRequest};
use crate::services::device_log_hdc_service::resolve_hdc_path;
use crate::services::device_log_runtime_service::DeviceLogRuntimeState;
use crate::services::device_log_service::DeviceLogRuntime;
use crate::services::device_log_stream_error_service::spawn_stream_error_reader;
use crate::services::device_log_stream_service::spawn_device_log_reader;
use crate::services::process_command_service::hidden_command;
use tauri::AppHandle;

const STREAM_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub fn start_stream(
    app: AppHandle,
    runtime: &DeviceLogRuntime,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    let stream_id = runtime.next_stream_id();
    let mut child = hidden_command(resolve_hdc_path())
        .args(["-t", &request.device_id, "hilog"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start hdc hilog: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture hdc hilog stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture hdc hilog stderr".to_string())?;
    let sink = runtime.create_stream_sink(&stream_id)?;
    spawn_device_log_reader(
        app,
        stream_id.clone(),
        request.device_id.clone(),
        stdout,
        Some(sink),
    );
    spawn_stream_error_reader(
        runtime.stats_state(),
        stream_id.clone(),
        request.device_id.clone(),
        stderr,
    );
    runtime
        .stats_state()
        .record_stream_running(&stream_id, &request.device_id);
    let child = runtime.insert_stream(stream_id.clone(), child);
    spawn_stream_exit_monitor(
        runtime.stats_state(),
        stream_id.clone(),
        request.device_id.clone(),
        child,
    );

    Ok(DeviceLogStreamSummary {
        stream_id,
        device_id: request.device_id,
        status: "running".to_string(),
    })
}

pub fn stop_stream(runtime: &DeviceLogRuntime, stream_id: &str) -> Result<(), String> {
    if let Some(child) = runtime.remove_stream(stream_id) {
        runtime.stats_state().record_stream_stopping(stream_id);
        let mut child = child.lock().expect("device log child lock");
        stop_child_process(&mut child)?;
        runtime.stats_state().record_stream_stopped(stream_id);
    }
    Ok(())
}

fn stop_child_process(child: &mut Child) -> Result<ExitStatus, String> {
    if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
        return Ok(status);
    }

    match child.kill() {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::InvalidInput => {}
        Err(error) => return Err(error.to_string()),
    }

    child.wait().map_err(|error| error.to_string())
}

fn spawn_stream_exit_monitor(
    runtime: Arc<DeviceLogRuntimeState>,
    stream_id: String,
    device_id: String,
    child: Arc<Mutex<Child>>,
) {
    thread::spawn(move || loop {
        if Arc::strong_count(&child) == 1 {
            break;
        }
        match poll_stream_exit_once(
            runtime.clone(),
            stream_id.clone(),
            device_id.clone(),
            child.clone(),
        ) {
            Ok(true) => break,
            Ok(false) => thread::sleep(STREAM_EXIT_POLL_INTERVAL),
            Err(error) => {
                runtime.record_stream_error(
                    &stream_id,
                    &device_id,
                    &format!("Failed to poll hdc hilog: {error}"),
                );
                break;
            }
        }
    });
}

fn poll_stream_exit_once(
    runtime: Arc<DeviceLogRuntimeState>,
    stream_id: String,
    device_id: String,
    child: Arc<Mutex<Child>>,
) -> Result<bool, String> {
    let Ok(mut child) = child.try_lock() else {
        return Ok(false);
    };
    let Some(status) = child.try_wait().map_err(|error| error.to_string())? else {
        return Ok(false);
    };

    runtime.record_stream_exit(
        &stream_id,
        &device_id,
        status.success(),
        &status.to_string(),
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn stop_child_process_kills_and_reaps_running_child() {
        let mut child = std::process::Command::new("sh")
            .args(["-c", "sleep 5"])
            .spawn()
            .expect("spawn sleep child");

        let status = stop_child_process(&mut child).expect("stop child");

        assert!(!status.success());
    }

    #[cfg(unix)]
    #[test]
    fn stop_child_process_handles_already_exited_child() {
        let mut child = std::process::Command::new("sh")
            .args(["-c", "exit 0"])
            .spawn()
            .expect("spawn exited child");
        for _ in 0..20 {
            if child.try_wait().expect("poll exited child").is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let status = stop_child_process(&mut child).expect("stop child");

        assert!(status.success());
    }

    #[cfg(unix)]
    #[test]
    fn stream_exit_poll_records_natural_child_failure() {
        let runtime = std::sync::Arc::new(
            crate::services::device_log_runtime_service::DeviceLogRuntimeState::default(),
        );
        runtime.record_stream_running("stream-1", "device-1");
        let child = std::sync::Arc::new(std::sync::Mutex::new(
            std::process::Command::new("sh")
                .args(["-c", "exit 7"])
                .spawn()
                .expect("spawn exited child"),
        ));

        let mut recorded = false;
        for _ in 0..20 {
            if poll_stream_exit_once(
                runtime.clone(),
                "stream-1".to_string(),
                "device-1".to_string(),
                child.clone(),
            )
            .expect("poll stream exit")
            {
                recorded = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        assert!(recorded);
        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.stream_status, "error");
        assert!(stats
            .last_error
            .as_deref()
            .expect("last error")
            .contains("exit status: 7"));
    }
}
