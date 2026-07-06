use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use crate::services::device_log_level_summary_service::{
    count_log_severities, summarize_log_levels,
};
use crate::services::device_log_metadata_service::{
    DeviceLogMetadataBatch, DeviceLogMetadataStore,
};
use crate::services::device_log_runtime_service::DeviceLogRuntimeState;
use crate::services::device_log_segment_service::DeviceLogSegmentWriter;
use crate::services::device_log_stream_service::DeviceLogBatchSink;

struct DeviceLogWriteJob {
    stream_id: String,
    device_id: String,
    lines: Vec<String>,
}

pub struct DeviceLogWriterWorkerSink {
    durable: Arc<DurableDeviceLogBatchSink>,
    sender: mpsc::SyncSender<DeviceLogWriteJob>,
}

impl DeviceLogWriterWorkerSink {
    pub fn new(durable: DurableDeviceLogBatchSink, capacity: usize) -> Self {
        let durable = Arc::new(durable);
        let (sender, receiver) = mpsc::sync_channel::<DeviceLogWriteJob>(capacity);
        let worker_durable = durable.clone();
        thread::spawn(move || {
            while let Ok(job) = receiver.recv() {
                worker_durable.persist_queued_batch(&job.stream_id, &job.device_id, &job.lines);
            }
        });
        Self { durable, sender }
    }
}

impl DeviceLogBatchSink for DeviceLogWriterWorkerSink {
    fn persist_batch(&self, stream_id: &str, device_id: &str, lines: &[String]) {
        self.durable
            .record_batch_queued(stream_id, device_id, lines.len() as u64);
        let job = DeviceLogWriteJob {
            stream_id: stream_id.to_string(),
            device_id: device_id.to_string(),
            lines: lines.to_vec(),
        };
        if let Err(error) = self.sender.send(job) {
            self.durable.runtime_state.record_drop(
                stream_id,
                error.0.lines.len() as u64,
                "Device log writer worker stopped",
            );
        }
    }
}

pub struct DurableDeviceLogBatchSink {
    writer: Mutex<DeviceLogSegmentWriter>,
    metadata: Mutex<DeviceLogMetadataStore>,
    runtime_state: Arc<DeviceLogRuntimeState>,
    next_seq: Mutex<u64>,
    now_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl DurableDeviceLogBatchSink {
    pub fn new(
        writer: DeviceLogSegmentWriter,
        metadata: DeviceLogMetadataStore,
        runtime_state: Arc<DeviceLogRuntimeState>,
    ) -> Self {
        Self {
            writer: Mutex::new(writer),
            metadata: Mutex::new(metadata),
            runtime_state,
            next_seq: Mutex::new(1),
            now_ms: Arc::new(current_time_ms),
        }
    }

    fn record_batch_queued(&self, stream_id: &str, device_id: &str, lines: u64) {
        self.runtime_state
            .record_ingested(stream_id, device_id, lines);
        self.runtime_state
            .record_batch_queued(stream_id, device_id, 1);
    }

    fn persist_queued_batch(&self, stream_id: &str, device_id: &str, lines: &[String]) {
        let started = Instant::now();
        let mut writer = self.writer.lock().expect("device log segment writer lock");
        let receipt = match writer.append_lines(lines) {
            Ok(receipt) => receipt,
            Err(error) => {
                self.runtime_state
                    .record_drop(stream_id, lines.len() as u64, &error);
                return;
            }
        };
        let first_seq = {
            let mut next_seq = self.next_seq.lock().expect("device log sequence lock");
            let first_seq = *next_seq;
            *next_seq = next_seq.saturating_add(receipt.line_count);
            first_seq
        };
        let insert_result = self
            .metadata
            .lock()
            .expect("device log metadata lock")
            .insert_batch(&DeviceLogMetadataBatch {
                stream_id: stream_id.to_string(),
                device_id: device_id.to_string(),
                first_seq,
                received_at_ms: (self.now_ms)(),
                line_count: receipt.line_count,
                segment_file: receipt.segment_file,
                segment_offset: receipt.offset,
                segment_bytes: receipt.bytes,
                levels: summarize_log_levels(lines),
            });
        match insert_result {
            Ok(()) => {
                let counts = count_log_severities(lines);
                self.runtime_state.record_persisted_with_severity_counts(
                    stream_id,
                    receipt.line_count,
                    receipt.bytes,
                    started.elapsed().as_millis() as u64,
                    counts.warn,
                    counts.error,
                    counts.fatal,
                );
            }
            Err(error) => self
                .runtime_state
                .record_drop(stream_id, receipt.line_count, &error),
        }
    }
}

impl DeviceLogBatchSink for DurableDeviceLogBatchSink {
    fn persist_batch(&self, stream_id: &str, device_id: &str, lines: &[String]) {
        self.record_batch_queued(stream_id, device_id, lines.len() as u64);
        self.persist_queued_batch(stream_id, device_id, lines);
    }
}

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{current_time_ms, DeviceLogWriterWorkerSink, DurableDeviceLogBatchSink};
    use crate::models::device_log_query::DeviceLogQueryRequest;
    use crate::services::device_log_metadata_service::DeviceLogMetadataStore;
    use crate::services::device_log_query_service::query_device_log_buffer;
    use crate::services::device_log_runtime_service::DeviceLogRuntimeState;
    use crate::services::device_log_segment_service::{
        read_segment_file_lines, DeviceLogSegmentWriter,
    };
    use crate::services::device_log_stream_service::DeviceLogBatchSink;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn durable_sink_persists_batch_metadata_and_stats() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let runtime = Arc::new(DeviceLogRuntimeState::default());
        let sink = DurableDeviceLogBatchSink::new(
            DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer"),
            DeviceLogMetadataStore::open(&temp).expect("metadata"),
            runtime.clone(),
        );

        sink.persist_batch(
            "stream-1",
            "device-1",
            &["one".to_string(), "two".to_string()],
        );

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.ingested_lines, 2);
        assert_eq!(stats.persisted_lines, 2);
        assert_eq!(stats.dropped_lines, 0);
        let rows = DeviceLogMetadataStore::open(&temp)
            .expect("metadata")
            .query_range("stream-1", 0, 9_999_999_999_999, 10)
            .expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            read_segment_file_lines(
                &temp,
                &rows[0].segment_file,
                rows[0].segment_offset,
                rows[0].segment_bytes
            )
            .expect("segment"),
            vec!["one", "two"]
        );
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn durable_sink_persists_batch_level_summary() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let runtime = Arc::new(DeviceLogRuntimeState::default());
        let sink = DurableDeviceLogBatchSink::new(
            DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer"),
            DeviceLogMetadataStore::open(&temp).expect("metadata"),
            runtime,
        );

        sink.persist_batch(
            "stream-1",
            "device-1",
            &[
                "06-25 15:21:48.123  1234  5678 I C03F00/AppTag demo: info one".to_string(),
                "06-25 15:21:49.123  1234  5678 E C03F00/AppTag demo: error two".to_string(),
            ],
        );

        let rows = DeviceLogMetadataStore::open(&temp)
            .expect("metadata")
            .query_range("stream-1", 0, 9_999_999_999_999, 10)
            .expect("rows");

        assert_eq!(
            rows[0].levels,
            vec!["info".to_string(), "error".to_string()]
        );
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn durable_sink_records_runtime_severity_counts() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let runtime = Arc::new(DeviceLogRuntimeState::default());
        let sink = DurableDeviceLogBatchSink::new(
            DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer"),
            DeviceLogMetadataStore::open(&temp).expect("metadata"),
            runtime.clone(),
        );

        sink.persist_batch(
            "stream-1",
            "device-1",
            &[
                "06-25 15:21:48.123  1234  5678 W C03F00/AppTag demo: warn".to_string(),
                "06-25 15:21:49.123  1234  5678 E C03F00/AppTag demo: error".to_string(),
                "06-25 15:21:50.123  1234  5678 F C03F00/AppTag demo: fatal".to_string(),
            ],
        );

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.warn_lines, 1);
        assert_eq!(stats.error_lines, 1);
        assert_eq!(stats.fatal_lines, 1);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn writer_worker_persists_batches_without_dropping_or_reordering() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let runtime = Arc::new(DeviceLogRuntimeState::default());
        let durable = DurableDeviceLogBatchSink::new(
            DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer"),
            DeviceLogMetadataStore::open(&temp).expect("metadata"),
            runtime.clone(),
        );
        let sink = DeviceLogWriterWorkerSink::new(durable, 4);

        sink.persist_batch(
            "stream-1",
            "device-1",
            &["one".to_string(), "two".to_string()],
        );
        sink.persist_batch("stream-1", "device-1", &["three".to_string()]);

        wait_for(|| {
            runtime
                .stats_for("stream-1")
                .is_some_and(|stats| stats.persisted_lines == 3 && stats.pending_batches == 0)
        });
        let rows = DeviceLogMetadataStore::open(&temp)
            .expect("metadata")
            .query_range("stream-1", 0, 9_999_999_999_999, 10)
            .expect("rows");
        let persisted = rows
            .iter()
            .rev()
            .flat_map(|row| {
                read_segment_file_lines(
                    &temp,
                    &row.segment_file,
                    row.segment_offset,
                    row.segment_bytes,
                )
                .expect("segment")
            })
            .collect::<Vec<_>>();

        assert_eq!(persisted, vec!["one", "two", "three"]);
        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.ingested_lines, 3);
        assert_eq!(stats.dropped_lines, 0);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn writer_worker_handles_high_volume_without_loss_and_keeps_regex_queryable() {
        const LINE_COUNT: usize = 20_000;
        const BATCH_SIZE: usize = 50;
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let runtime = Arc::new(DeviceLogRuntimeState::default());
        let durable = DurableDeviceLogBatchSink::new(
            DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer"),
            DeviceLogMetadataStore::open(&temp).expect("metadata"),
            runtime.clone(),
        );
        let sink = DeviceLogWriterWorkerSink::new(durable, 64);

        for batch_start in (0..LINE_COUNT).step_by(BATCH_SIZE) {
            let lines = (batch_start..batch_start + BATCH_SIZE)
                .map(|index| format!(
                    "06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: pressure target {index}"
                ))
                .collect::<Vec<_>>();
            sink.persist_batch("stream-1", "device-1", &lines);
        }

        wait_for(|| {
            runtime.stats_for("stream-1").is_some_and(|stats| {
                stats.ingested_lines == LINE_COUNT as u64
                    && stats.persisted_lines == LINE_COUNT as u64
                    && stats.pending_batches == 0
            })
        });
        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.dropped_lines, 0);
        assert!(stats.last_write_ms < 1_000);
        assert!(stats.slow_write_batches < (LINE_COUNT / BATCH_SIZE) as u64);
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "pressure target 1999[0-9]".to_string();
        request.regex = true;
        request.limit = 10;

        let response = query_device_log_buffer(&temp, &request, current_time_ms()).expect("query");

        assert_eq!(response.rows.len(), 10);
        assert_eq!(response.rows[0].message, "pressure target 19990");
        assert_eq!(response.rows[9].message, "pressure target 19999");
        fs::remove_dir_all(temp).expect("cleanup");
    }

    fn wait_for(condition: impl Fn() -> bool) {
        for _ in 0..50 {
            if condition() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("condition timed out");
    }

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "arkline-device-log-writer-{}-{nanos}-{counter}",
            std::process::id(),
        ))
    }
}
