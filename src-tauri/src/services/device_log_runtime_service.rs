use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::device_log_query::DeviceLogRuntimeStats;

const SLOW_WRITE_BATCH_MS: u64 = 10;
const BACKPRESSURE_HIGH_WATERMARK: usize = 100;
const BACKPRESSURE_LOW_WATERMARK: usize = 25;

#[derive(Default)]
pub struct DeviceLogRuntimeState {
    stats_by_stream: Mutex<HashMap<String, DeviceLogRuntimeStats>>,
}

impl DeviceLogRuntimeState {
    pub fn record_batch_queued(&self, stream_id: &str, device_id: &str, batches: usize) {
        self.update(stream_id, |stats| {
            stats.stream_id = stream_id.to_string();
            stats.device_id = device_id.to_string();
            stats.pending_batches = stats.pending_batches.saturating_add(batches);
            refresh_backpressure_state(stats);
        });
    }

    pub fn record_ingested(&self, stream_id: &str, device_id: &str, lines: u64) {
        self.update(stream_id, |stats| {
            stats.stream_id = stream_id.to_string();
            stats.device_id = device_id.to_string();
            stats.ingested_lines = stats.ingested_lines.saturating_add(lines);
        });
    }

    #[cfg(test)]
    pub fn record_persisted_with_latency(
        &self,
        stream_id: &str,
        lines: u64,
        bytes: u64,
        write_ms: u64,
    ) {
        self.record_persisted_with_severity_counts(stream_id, lines, bytes, write_ms, 0, 0, 0);
    }

    pub fn record_persisted_with_severity_counts(
        &self,
        stream_id: &str,
        lines: u64,
        bytes: u64,
        write_ms: u64,
        warn_lines: u64,
        error_lines: u64,
        fatal_lines: u64,
    ) {
        self.update(stream_id, |stats| {
            stats.persisted_lines = stats.persisted_lines.saturating_add(lines);
            stats.pending_batches = stats.pending_batches.saturating_sub(1);
            stats.buffer_bytes = stats.buffer_bytes.saturating_add(bytes);
            stats.last_write_ms = write_ms;
            stats.warn_lines = stats.warn_lines.saturating_add(warn_lines);
            stats.error_lines = stats.error_lines.saturating_add(error_lines);
            stats.fatal_lines = stats.fatal_lines.saturating_add(fatal_lines);
            if write_ms >= SLOW_WRITE_BATCH_MS {
                stats.slow_write_batches = stats.slow_write_batches.saturating_add(1);
            }
            refresh_backpressure_state(stats);
        });
    }

    pub fn record_stream_running(&self, stream_id: &str, device_id: &str) {
        self.update(stream_id, |stats| {
            stats.stream_id = stream_id.to_string();
            stats.device_id = device_id.to_string();
            stats.stream_status = "running".to_string();
        });
    }

    pub fn record_stream_stopping(&self, stream_id: &str) {
        self.update(stream_id, |stats| {
            stats.stream_status = "stopping".to_string();
        });
    }

    pub fn record_stream_stopped(&self, stream_id: &str) {
        self.update(stream_id, |stats| {
            stats.stream_status = "stopped".to_string();
        });
    }

    pub fn record_stream_exit(
        &self,
        stream_id: &str,
        device_id: &str,
        success: bool,
        detail: &str,
    ) {
        if success {
            self.update(stream_id, |stats| {
                stats.stream_id = stream_id.to_string();
                stats.device_id = device_id.to_string();
                stats.stream_status = "stopped".to_string();
                stats.last_error = None;
            });
            return;
        }

        self.record_stream_error(stream_id, device_id, &format!("hdc hilog exited: {detail}"));
    }

    pub fn record_drop(&self, stream_id: &str, lines: u64, reason: &str) {
        self.update(stream_id, |stats| {
            stats.dropped_lines = stats.dropped_lines.saturating_add(lines);
            stats.pending_batches = stats.pending_batches.saturating_sub(1);
            stats.backpressure_state = "dropping".to_string();
            stats.last_error = Some(reason.to_string());
        });
    }

    pub fn record_stream_error(&self, stream_id: &str, device_id: &str, reason: &str) {
        self.update(stream_id, |stats| {
            stats.stream_id = stream_id.to_string();
            stats.device_id = device_id.to_string();
            stats.stream_status = "error".to_string();
            stats.last_error = Some(reason.to_string());
        });
    }

    pub fn stats_for(&self, stream_id: &str) -> Option<DeviceLogRuntimeStats> {
        self.stats_by_stream
            .lock()
            .expect("device log runtime stats lock")
            .get(stream_id)
            .cloned()
    }

    fn update(&self, stream_id: &str, update: impl FnOnce(&mut DeviceLogRuntimeStats)) {
        let mut stats_by_stream = self
            .stats_by_stream
            .lock()
            .expect("device log runtime stats lock");
        let stats = stats_by_stream.entry(stream_id.to_string()).or_default();
        update(stats);
    }
}

fn refresh_backpressure_state(stats: &mut DeviceLogRuntimeStats) {
    if stats.pending_batches == 0 {
        stats.backpressure_state = "idle".to_string();
        return;
    }
    if stats.pending_batches >= BACKPRESSURE_HIGH_WATERMARK {
        stats.backpressure_state = "saturated".to_string();
        return;
    }
    if stats.backpressure_state == "saturated"
        && stats.pending_batches >= BACKPRESSURE_LOW_WATERMARK
    {
        return;
    }
    stats.backpressure_state = "buffering".to_string();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_ingested_and_persisted_lines_without_drop() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_ingested("stream-1", "device-1", 25);
        runtime.record_persisted_with_latency("stream-1", 25, 1024, 0);

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.ingested_lines, 25);
        assert_eq!(stats.persisted_lines, 25);
        assert_eq!(stats.dropped_lines, 0);
        assert_eq!(stats.buffer_bytes, 1024);
    }

    #[test]
    fn records_writer_latency_and_slow_batches() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_ingested("stream-1", "device-1", 25);
        runtime.record_batch_queued("stream-1", "device-1", 1);
        runtime.record_persisted_with_latency("stream-1", 25, 1024, 12);

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.last_write_ms, 12);
        assert_eq!(stats.slow_write_batches, 1);
    }

    #[test]
    fn records_persisted_severity_counts_for_status_strip() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_ingested("stream-1", "device-1", 4);
        runtime.record_batch_queued("stream-1", "device-1", 1);
        runtime.record_persisted_with_severity_counts("stream-1", 4, 1024, 0, 1, 2, 1);

        let stats = runtime.stats_for("stream-1").expect("stats");
        assert_eq!(stats.warn_lines, 1);
        assert_eq!(stats.error_lines, 2);
        assert_eq!(stats.fatal_lines, 1);
    }

    #[test]
    fn tracks_pending_batches_with_high_low_watermarks() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_batch_queued("stream-1", "device-1", 1);
        let buffering = runtime.stats_for("stream-1").expect("buffering stats");
        assert_eq!(buffering.pending_batches, 1);
        assert_eq!(buffering.backpressure_state, "buffering");

        runtime.record_batch_queued("stream-1", "device-1", 99);
        let saturated = runtime.stats_for("stream-1").expect("saturated stats");
        assert_eq!(saturated.pending_batches, 100);
        assert_eq!(saturated.backpressure_state, "saturated");

        runtime.record_persisted_with_latency("stream-1", 25, 1024, 0);
        let still_saturated = runtime
            .stats_for("stream-1")
            .expect("still saturated stats");
        assert_eq!(still_saturated.pending_batches, 99);
        assert_eq!(still_saturated.backpressure_state, "saturated");

        for _ in 0..75 {
            runtime.record_persisted_with_latency("stream-1", 25, 1024, 0);
        }
        let drained = runtime.stats_for("stream-1").expect("drained stats");
        assert_eq!(drained.pending_batches, 24);
        assert_eq!(drained.backpressure_state, "buffering");
    }

    #[test]
    fn drop_records_failure_without_underflowing_pending_batches() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_drop("stream-1", 3, "write failed");
        let stats = runtime.stats_for("stream-1").expect("stats");

        assert_eq!(stats.pending_batches, 0);
        assert_eq!(stats.dropped_lines, 3);
        assert_eq!(stats.backpressure_state, "dropping");
        assert_eq!(stats.last_error.as_deref(), Some("write failed"));
    }

    #[test]
    fn stream_error_records_last_error_without_counting_dropped_lines() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_stream_error("stream-1", "device-1", "hdc disconnected");
        let stats = runtime.stats_for("stream-1").expect("stats");

        assert_eq!(stats.stream_id, "stream-1");
        assert_eq!(stats.device_id, "device-1");
        assert_eq!(stats.dropped_lines, 0);
        assert_eq!(stats.last_error.as_deref(), Some("hdc disconnected"));
    }

    #[test]
    fn stream_lifecycle_records_running_stopping_stopped_and_error_states() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_stream_running("stream-1", "device-1");
        assert_eq!(
            runtime
                .stats_for("stream-1")
                .expect("running")
                .stream_status,
            "running"
        );

        runtime.record_stream_stopping("stream-1");
        assert_eq!(
            runtime
                .stats_for("stream-1")
                .expect("stopping")
                .stream_status,
            "stopping"
        );

        runtime.record_stream_stopped("stream-1");
        assert_eq!(
            runtime
                .stats_for("stream-1")
                .expect("stopped")
                .stream_status,
            "stopped"
        );

        runtime.record_stream_error("stream-1", "device-1", "hdc disconnected");
        assert_eq!(
            runtime.stats_for("stream-1").expect("error").stream_status,
            "error"
        );
    }

    #[test]
    fn stream_exit_records_stopped_or_error_state() {
        let runtime = DeviceLogRuntimeState::default();

        runtime.record_stream_running("stream-ok", "device-1");
        runtime.record_stream_exit("stream-ok", "device-1", true, "exit status: 0");
        let stopped = runtime.stats_for("stream-ok").expect("stopped");
        assert_eq!(stopped.stream_status, "stopped");
        assert_eq!(stopped.last_error, None);

        runtime.record_stream_running("stream-failed", "device-1");
        runtime.record_stream_exit("stream-failed", "device-1", false, "exit status: 1");
        let failed = runtime.stats_for("stream-failed").expect("failed");
        assert_eq!(failed.stream_status, "error");
        assert_eq!(
            failed.last_error.as_deref(),
            Some("hdc hilog exited: exit status: 1")
        );
    }
}
