use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;

const WRITER_SAMPLE_LIMIT: usize = 128;

#[derive(Debug, Default)]
pub(crate) struct WorkspaceIndexConnectionMetrics {
    states: Mutex<HashMap<PathBuf, WriterMetricState>>,
}

impl WorkspaceIndexConnectionMetrics {
    pub(crate) fn mark_queued(&self, store_path: &Path) {
        self.update(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_add(1);
        });
    }

    pub(crate) fn mark_acquired(&self, store_path: &Path) {
        self.update(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_sub(1);
            metrics.active_writer_count = metrics.active_writer_count.saturating_add(1);
        });
    }

    pub(crate) fn mark_lock_failed(&self, store_path: &Path) {
        self.update(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_sub(1);
            metrics.failure_count = metrics.failure_count.saturating_add(1);
        });
    }

    pub(crate) fn record_finished(
        &self,
        store_path: &Path,
        wait_duration: Duration,
        hold_duration: Duration,
        failed: bool,
    ) {
        self.update(store_path, |metrics| {
            metrics.active_writer_count = metrics.active_writer_count.saturating_sub(1);
            metrics.sample_count = metrics.sample_count.saturating_add(1);
            metrics.failure_count = metrics.failure_count.saturating_add(u64::from(failed));
            push_bounded(&mut metrics.wait_samples_us, duration_us(wait_duration));
            push_bounded(&mut metrics.hold_samples_us, duration_us(hold_duration));
        });
    }

    pub(crate) fn snapshot(&self, store_path: &Path) -> WorkspaceIndexWriterMetrics {
        self.states
            .lock()
            .ok()
            .and_then(|states| states.get(store_path).map(WriterMetricState::snapshot))
            .unwrap_or_default()
    }

    pub(crate) fn clear(&self, store_path: &Path) -> Result<(), String> {
        self.states
            .lock()
            .map_err(|_| "Workspace index writer metrics poisoned".to_string())?
            .remove(store_path);
        Ok(())
    }

    fn update(&self, store_path: &Path, update: impl FnOnce(&mut WriterMetricState)) {
        let Ok(mut states) = self.states.lock() else {
            return;
        };
        update(states.entry(store_path.to_path_buf()).or_default());
    }
}

#[derive(Debug, Default)]
struct WriterMetricState {
    sample_count: u64,
    active_writer_count: usize,
    queued_writer_count: usize,
    failure_count: u64,
    wait_samples_us: VecDeque<u64>,
    hold_samples_us: VecDeque<u64>,
}

impl WriterMetricState {
    fn snapshot(&self) -> WorkspaceIndexWriterMetrics {
        let wait = percentiles(&self.wait_samples_us);
        let hold = percentiles(&self.hold_samples_us);
        WorkspaceIndexWriterMetrics {
            sample_count: self.sample_count,
            active_writer_count: self.active_writer_count,
            queued_writer_count: self.queued_writer_count,
            failure_count: self.failure_count,
            wait_p50_us: wait.p50,
            wait_p95_us: wait.p95,
            wait_p99_us: wait.p99,
            wait_max_us: wait.max,
            hold_p50_us: hold.p50,
            hold_p95_us: hold.p95,
            hold_p99_us: hold.p99,
            hold_max_us: hold.max,
            last_wait_us: self.wait_samples_us.back().copied().unwrap_or_default(),
            last_hold_us: self.hold_samples_us.back().copied().unwrap_or_default(),
            ..WorkspaceIndexWriterMetrics::default()
        }
    }
}

#[derive(Default)]
struct Percentiles {
    p50: u64,
    p95: u64,
    p99: u64,
    max: u64,
}

fn percentiles(samples: &VecDeque<u64>) -> Percentiles {
    let mut sorted = samples.iter().copied().collect::<Vec<_>>();
    sorted.sort_unstable();
    Percentiles {
        p50: percentile(&sorted, 50),
        p95: percentile(&sorted, 95),
        p99: percentile(&sorted, 99),
        max: sorted.last().copied().unwrap_or_default(),
    }
}

fn percentile(sorted: &[u64], percentile: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let index = (sorted.len() * percentile).div_ceil(100).saturating_sub(1);
    sorted[index.min(sorted.len() - 1)]
}

fn push_bounded(samples: &mut VecDeque<u64>, value: u64) {
    if samples.len() == WRITER_SAMPLE_LIMIT {
        samples.pop_front();
    }
    samples.push_back(value);
}

fn duration_us(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}
