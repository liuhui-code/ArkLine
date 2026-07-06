use std::process::Stdio;

use crate::models::device_log::DeviceLogDevice;
use crate::services::process_command_service::hidden_command;

pub fn list_devices() -> Result<Vec<DeviceLogDevice>, String> {
    let output = hidden_command(resolve_hdc_path())
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

pub(crate) fn resolve_hdc_path() -> String {
    "hdc".to_string()
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
