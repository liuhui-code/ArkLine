use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::device_log::{
    DeviceFaultLogFetchResult, DeviceFaultLogRawEntry, ListDeviceFaultLogsRequest,
};
use crate::services::device_log_hdc_service::resolve_hdc_path;
use crate::services::process_command_service::hidden_command;

pub fn list_fault_logs(
    request: ListDeviceFaultLogsRequest,
) -> Result<DeviceFaultLogFetchResult, String> {
    let command = format!(
        "{} -t {} shell faultloggerd --dump",
        resolve_hdc_path(),
        request.device_id
    );
    let output = hidden_command(resolve_hdc_path())
        .args(["-t", &request.device_id, "shell", "faultloggerd", "--dump"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to run {command}: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    Ok(normalize_fault_log_output(
        &request.device_id,
        command,
        &stdout,
        &stderr,
        output.status.success(),
    ))
}

pub fn normalize_fault_log_output(
    device_id: &str,
    command: String,
    stdout: &str,
    stderr: &str,
    command_succeeded: bool,
) -> DeviceFaultLogFetchResult {
    let normalized_stdout = stdout.replace("\r\n", "\n");
    let normalized_stderr = stderr.replace("\r\n", "\n");
    let combined = format!("{normalized_stdout}\n{normalized_stderr}");
    let combined_lower = combined.to_ascii_lowercase();

    let (status, message, entries) = if combined.contains("Connect server failed") {
        (
            "unavailable".to_string(),
            message_from_text(
                "Connect server failed",
                &normalized_stderr,
                "Device fault logs unavailable",
            ),
            Vec::new(),
        )
    } else if combined_lower.contains("unauthorized")
        || combined_lower.contains("permission denied")
        || combined_lower.contains("authentication failed")
    {
        (
            "unauthorized".to_string(),
            message_from_text(
                "Device authorization required",
                &combined,
                "Device authorization required",
            ),
            Vec::new(),
        )
    } else if !command_succeeded {
        (
            "error".to_string(),
            message_from_text(
                "Fault log command failed",
                if normalized_stderr.trim().is_empty() {
                    &normalized_stdout
                } else {
                    &normalized_stderr
                },
                "Fault log command failed",
            ),
            Vec::new(),
        )
    } else {
        let entries = split_fault_log_entries(device_id, &normalized_stdout);
        if entries.is_empty() {
            (
                "empty".to_string(),
                "No fault logs found".to_string(),
                Vec::new(),
            )
        } else {
            ("ready".to_string(), "ok".to_string(), entries)
        }
    };

    DeviceFaultLogFetchResult {
        device_id: device_id.to_string(),
        fetched_at: current_timestamp_string(),
        entries,
        command,
        stderr: normalized_stderr,
        status,
        message,
    }
}

fn split_fault_log_entries(device_id: &str, stdout: &str) -> Vec<DeviceFaultLogRawEntry> {
    let mut entries = Vec::new();
    let mut current = Vec::new();
    let mut lines = stdout.lines().peekable();

    while let Some(line) = lines.next() {
        if line.trim().is_empty() {
            if should_split_fault_entry(&current, lines.peek().copied()) {
                push_fault_log_entry(device_id, &mut entries, &mut current);
            } else if !current.is_empty() {
                current.push("");
            }
            continue;
        }

        current.push(line);
    }

    push_fault_log_entry(device_id, &mut entries, &mut current);
    entries
}

fn should_split_fault_entry(current: &[&str], next_line: Option<&str>) -> bool {
    if current.is_empty() {
        return false;
    }

    let Some(next_line) = next_line.map(str::trim) else {
        return true;
    };

    if next_line.is_empty() {
        return false;
    }

    looks_like_fault_entry_start(next_line) && current.iter().any(|line| line.contains(':'))
}

fn looks_like_fault_entry_start(line: &str) -> bool {
    matches!(
        line.split(':').next().map(str::trim),
        Some(
            "Timestamp"
                | "Reason"
                | "Process"
                | "PID"
                | "BundleName"
                | "Summary"
                | "Module"
                | "FaultType"
        )
    )
}

fn push_fault_log_entry(
    device_id: &str,
    entries: &mut Vec<DeviceFaultLogRawEntry>,
    current: &mut Vec<&str>,
) {
    if current.is_empty() {
        return;
    }

    let raw = current.join("\n");
    let entry_number = entries.len() + 1;
    entries.push(DeviceFaultLogRawEntry {
        id: format!("{device_id}-fault-{entry_number}"),
        raw,
    });
    current.clear();
}

fn message_from_text(default_message: &str, text: &str, fallback: &str) -> String {
    text.lines()
        .find_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| {
            if default_message.is_empty() {
                fallback.to_string()
            } else {
                default_message.to_string()
            }
        })
}

fn current_timestamp_string() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let seconds = duration.as_secs() as i64;
            format_unix_timestamp_as_iso(seconds)
        }
        Err(_) => "0".to_string(),
    }
}

fn format_unix_timestamp_as_iso(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }

    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_fault_log_connect_server_failure_to_unavailable() {
        let result = normalize_fault_log_output(
            "device-1",
            "hdc faultlog".to_string(),
            "",
            "Connect server failed",
            false,
        );

        assert_eq!(result.status, "unavailable");
        assert!(result.message.contains("Connect server failed"));
    }

    #[test]
    fn normalizes_fault_log_success_to_ready_with_iso_timestamp() {
        let result = normalize_fault_log_output(
            "device-1",
            "hdc shell".to_string(),
            "Reason: JS_ERROR\nProcess: app.one\n\nReason: APP_FREEZE\nProcess: app.two",
            "",
            true,
        );

        assert_eq!(result.status, "ready");
        assert_eq!(result.entries.len(), 2);
        assert!(result.entries[0].raw.contains("JS_ERROR"));
        assert!(result.fetched_at.contains('T'));
        assert!(result.fetched_at.ends_with('Z'));
    }

    #[test]
    fn normalizes_fault_log_unauthorized_output() {
        let result = normalize_fault_log_output(
            "device-1",
            "hdc shell".to_string(),
            "",
            "device unauthorized",
            false,
        );

        assert_eq!(result.status, "unauthorized");
        assert!(result.message.to_ascii_lowercase().contains("unauthorized"));
    }

    #[test]
    fn normalizes_non_success_fault_log_command_to_error() {
        let result = normalize_fault_log_output(
            "device-1",
            "hdc shell".to_string(),
            "",
            "faultloggerd failed to dump",
            false,
        );

        assert_eq!(result.status, "error");
        assert!(result.message.contains("faultloggerd failed to dump"));
        assert_eq!(result.stderr, "faultloggerd failed to dump");
    }

    #[test]
    fn preserves_internal_blank_lines_within_single_fault_entry() {
        let result = normalize_fault_log_output(
            "device-1",
            "hdc shell".to_string(),
            "Timestamp: 2026-06-25 15:21:48\nReason: JS_ERROR\nProcess: app.one\nSummary: Render failed\n\nStacktrace:\n  at render (pages/index.ets:12:3)\n  at update (pages/app.ets:44:9)",
            "",
            true,
        );

        assert_eq!(result.status, "ready");
        assert_eq!(result.entries.len(), 1);
        assert!(result.entries[0].raw.contains("Stacktrace:"));
    }
}
