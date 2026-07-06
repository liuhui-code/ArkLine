use std::io::{BufRead, BufReader, Read};
use std::sync::Arc;
use std::thread;

use crate::services::device_log_runtime_service::DeviceLogRuntimeState;

pub fn spawn_stream_error_reader<R>(
    runtime: Arc<DeviceLogRuntimeState>,
    stream_id: String,
    device_id: String,
    stderr: R,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        record_stream_stderr(runtime, stream_id, device_id, stderr);
    });
}

fn record_stream_stderr<R: Read>(
    runtime: Arc<DeviceLogRuntimeState>,
    stream_id: String,
    device_id: String,
    stderr: R,
) {
    let mut last_error = None;
    for line in StderrLineReader::new(BufReader::new(stderr)) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            last_error = Some(trimmed.to_string());
        }
    }
    if let Some(error) = last_error {
        runtime.record_stream_error(&stream_id, &device_id, &error);
    }
}

struct StderrLineReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: BufRead> StderrLineReader<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
        }
    }
}

impl<R: BufRead> Iterator for StderrLineReader<R> {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        self.buffer.clear();
        match self.reader.read_until(b'\n', &mut self.buffer) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(decode_stderr_line(&self.buffer)),
        }
    }
}

fn decode_stderr_line(bytes: &[u8]) -> String {
    let bytes = bytes
        .strip_suffix(b"\n")
        .unwrap_or(bytes)
        .strip_suffix(b"\r")
        .unwrap_or(bytes);
    String::from_utf8_lossy(bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn captures_last_non_empty_stderr_line_as_stream_error() {
        let runtime = Arc::new(DeviceLogRuntimeState::default());

        record_stream_stderr(
            runtime.clone(),
            "stream-1".to_string(),
            "device-1".to_string(),
            b"\nwarning\nhdc disconnected\n".as_slice(),
        );

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.last_error.as_deref(), Some("hdc disconnected"));
        assert_eq!(stats.dropped_lines, 0);
    }

    #[test]
    fn keeps_stderr_diagnostics_after_invalid_utf8() {
        let runtime = Arc::new(DeviceLogRuntimeState::default());

        record_stream_stderr(
            runtime.clone(),
            "stream-1".to_string(),
            "device-1".to_string(),
            b"bad-\xff-line\nfinal error\n".as_slice(),
        );

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.last_error.as_deref(), Some("final error"));
    }
}
