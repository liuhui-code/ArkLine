use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::models::device_log::DeviceLogOutputBatch;
use tauri::{AppHandle, Emitter};

const MAX_BATCH_LINES: usize = 50;
const MAX_PENDING_LINES: usize = 10_000;
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);

pub fn spawn_device_log_reader<R>(
    app: AppHandle,
    stream_id: String,
    device_id: String,
    stdout: R,
    sink: Option<Arc<dyn DeviceLogBatchSink>>,
) where
    R: Read + Send + 'static,
{
    let (sender, receiver) = create_line_queue(MAX_PENDING_LINES);
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in LossyLogLineReader::new(reader) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    thread::spawn(move || {
        let mut batcher = DeviceLogBatcher::default();
        loop {
            match receiver.recv_timeout(FLUSH_INTERVAL) {
                Ok(line) => {
                    if let Some(lines) = batcher.push(line) {
                        emit_batch(&app, &stream_id, &device_id, lines, sink.as_deref());
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(lines) = batcher.flush() {
                        emit_batch(&app, &stream_id, &device_id, lines, sink.as_deref());
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(lines) = batcher.flush() {
                        emit_batch(&app, &stream_id, &device_id, lines, sink.as_deref());
                    }
                    break;
                }
            }
        }
    });
}

fn create_line_queue(capacity: usize) -> (mpsc::SyncSender<String>, mpsc::Receiver<String>) {
    mpsc::sync_channel(capacity)
}

struct LossyLogLineReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: BufRead> LossyLogLineReader<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
        }
    }
}

impl<R: BufRead> Iterator for LossyLogLineReader<R> {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        self.buffer.clear();
        match self.reader.read_until(b'\n', &mut self.buffer) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(decode_log_line(&self.buffer)),
        }
    }
}

fn decode_log_line(bytes: &[u8]) -> String {
    let bytes = bytes
        .strip_suffix(b"\n")
        .unwrap_or(bytes)
        .strip_suffix(b"\r")
        .unwrap_or_else(|| bytes.strip_suffix(b"\n").unwrap_or(bytes));
    String::from_utf8_lossy(bytes).to_string()
}

#[cfg(test)]
fn read_lossy_log_lines<R: Read>(input: R) -> std::io::Result<Vec<String>> {
    Ok(LossyLogLineReader::new(BufReader::new(input)).collect())
}

pub trait DeviceLogBatchSink: Send + Sync {
    fn persist_batch(&self, stream_id: &str, device_id: &str, lines: &[String]);
}

fn emit_batch(
    app: &AppHandle,
    stream_id: &str,
    device_id: &str,
    lines: Vec<String>,
    sink: Option<&dyn DeviceLogBatchSink>,
) {
    deliver_batch(stream_id, device_id, lines, sink, |lines| {
        let _ = app.emit(
            "device-log-output",
            DeviceLogOutputBatch {
                stream_id: stream_id.to_string(),
                device_id: device_id.to_string(),
                lines: lines.to_vec(),
            },
        );
    });
}

fn deliver_batch(
    stream_id: &str,
    device_id: &str,
    lines: Vec<String>,
    sink: Option<&dyn DeviceLogBatchSink>,
    emit: impl FnOnce(&[String]),
) {
    emit(&lines);
    if let Some(sink) = sink {
        sink.persist_batch(stream_id, device_id, &lines);
    }
}

#[derive(Default)]
struct DeviceLogBatcher {
    lines: Vec<String>,
}

impl DeviceLogBatcher {
    fn push(&mut self, line: String) -> Option<Vec<String>> {
        self.lines.push(line);
        if self.lines.len() >= MAX_BATCH_LINES {
            return self.flush();
        }
        None
    }

    fn flush(&mut self) -> Option<Vec<String>> {
        if self.lines.is_empty() {
            return None;
        }
        Some(std::mem::take(&mut self.lines))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_line_queue, deliver_batch, read_lossy_log_lines, DeviceLogBatchSink,
        DeviceLogBatcher,
    };
    use std::sync::{mpsc::TrySendError, Mutex};

    #[test]
    fn flushes_when_max_batch_size_is_reached() {
        let mut batcher = DeviceLogBatcher::default();

        for index in 0..49 {
            assert!(batcher.push(format!("line {index}")).is_none());
        }
        let lines = batcher.push("line 49".to_string()).expect("batch");

        assert_eq!(lines.len(), 50);
        assert!(batcher.flush().is_none());
    }

    #[test]
    fn flushes_partial_batch_without_dropping_lines() {
        let mut batcher = DeviceLogBatcher::default();

        assert!(batcher.push("one".to_string()).is_none());
        assert!(batcher.push("two".to_string()).is_none());

        assert_eq!(
            batcher.flush(),
            Some(vec!["one".to_string(), "two".to_string()])
        );
    }

    #[test]
    fn line_queue_applies_bounded_backpressure_without_reordering() {
        let (sender, receiver) = create_line_queue(2);

        sender.try_send("one".to_string()).expect("first line");
        sender.try_send("two".to_string()).expect("second line");
        let overflow = sender
            .try_send("three".to_string())
            .expect_err("bounded queue");

        assert!(matches!(overflow, TrySendError::Full(line) if line == "three"));
        assert_eq!(receiver.try_recv().expect("first received"), "one");
        sender
            .try_send("three".to_string())
            .expect("space after receive");
        assert_eq!(receiver.try_recv().expect("second received"), "two");
        assert_eq!(receiver.try_recv().expect("third received"), "three");
    }

    #[test]
    fn batch_delivery_emits_before_persisting() {
        let events = Mutex::new(Vec::<String>::new());
        let sink = RecordingSink { events: &events };

        deliver_batch(
            "stream-1",
            "device-1",
            vec!["line one".to_string()],
            Some(&sink),
            |_| events.lock().expect("events").push("emit".to_string()),
        );

        assert_eq!(
            events.lock().expect("events").as_slice(),
            ["emit".to_string(), "persist".to_string()]
        );
    }

    #[test]
    fn reader_keeps_stream_after_invalid_utf8_bytes() {
        let input = b"ok\nbad-\xff-line\nafter\n";

        let lines = read_lossy_log_lines(&input[..]).expect("lines");

        assert_eq!(lines, vec!["ok", "bad-\u{fffd}-line", "after"]);
    }

    #[test]
    fn reader_keeps_final_line_without_trailing_newline() {
        let input = b"one\ntwo";

        let lines = read_lossy_log_lines(&input[..]).expect("lines");

        assert_eq!(lines, vec!["one", "two"]);
    }

    struct RecordingSink<'a> {
        events: &'a Mutex<Vec<String>>,
    }

    impl DeviceLogBatchSink for RecordingSink<'_> {
        fn persist_batch(&self, _stream_id: &str, _device_id: &str, _lines: &[String]) {
            self.events
                .lock()
                .expect("events")
                .push("persist".to_string());
        }
    }
}
