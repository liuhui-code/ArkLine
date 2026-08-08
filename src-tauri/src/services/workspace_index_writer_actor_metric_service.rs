use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::maintenance_metric::MaintenanceMetricSample;
use super::WorkspaceIndexPublicationKind;
use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;

const METRIC_SAMPLE_LIMIT: usize = 128;

#[derive(Default)]
pub(super) struct WriterActorMetricState {
    pub(super) sample_count: u64,
    pub(super) queued: usize,
    pub(super) active: usize,
    pub(super) failures: u64,
    pub(super) recovered_roots: HashSet<String>,
    pub(super) recovery_workspace_count: u64,
    pub(super) orphan_artifact_scanned_count: u64,
    pub(super) orphan_artifact_removed_count: u64,
    pub(super) orphan_artifact_retained_count: u64,
    pub(super) recovery_failure_count: u64,
    sdk_publication_count: u64,
    sdk_publication_max_us: u64,
    content_core_publication_count: u64,
    content_core_publication_max_us: u64,
    content_substring_publication_count: u64,
    content_substring_publication_max_us: u64,
    maintenance_publication_count: u64,
    maintenance_publication_max_us: u64,
    maintenance_optimize_count: u64,
    maintenance_checkpoint_count: u64,
    maintenance_incremental_vacuum_count: u64,
    maintenance_copy_swap_count: u64,
    maintenance_copy_swap_deferred_count: u64,
    wait_us: VecDeque<u64>,
    hold_us: VecDeque<u64>,
}

impl WriterActorMetricState {
    pub(super) fn snapshot(&self) -> WorkspaceIndexWriterMetrics {
        WorkspaceIndexWriterMetrics {
            sample_count: self.sample_count,
            active_writer_count: self.active,
            queued_writer_count: self.queued,
            failure_count: self.failures,
            recovery_workspace_count: self.recovery_workspace_count,
            orphan_artifact_scanned_count: self.orphan_artifact_scanned_count,
            orphan_artifact_removed_count: self.orphan_artifact_removed_count,
            orphan_artifact_retained_count: self.orphan_artifact_retained_count,
            recovery_failure_count: self.recovery_failure_count,
            sdk_publication_count: self.sdk_publication_count,
            sdk_publication_max_us: self.sdk_publication_max_us,
            content_core_publication_count: self.content_core_publication_count,
            content_core_publication_max_us: self.content_core_publication_max_us,
            content_substring_publication_count: self.content_substring_publication_count,
            content_substring_publication_max_us: self.content_substring_publication_max_us,
            maintenance_publication_count: self.maintenance_publication_count,
            maintenance_publication_max_us: self.maintenance_publication_max_us,
            maintenance_optimize_count: self.maintenance_optimize_count,
            maintenance_checkpoint_count: self.maintenance_checkpoint_count,
            maintenance_incremental_vacuum_count: self.maintenance_incremental_vacuum_count,
            maintenance_copy_swap_count: self.maintenance_copy_swap_count,
            maintenance_copy_swap_deferred_count: self.maintenance_copy_swap_deferred_count,
            wait_p50_us: percentile(&self.wait_us, 50),
            wait_p95_us: percentile(&self.wait_us, 95),
            wait_p99_us: percentile(&self.wait_us, 99),
            wait_max_us: self.wait_us.iter().copied().max().unwrap_or_default(),
            hold_p50_us: percentile(&self.hold_us, 50),
            hold_p95_us: percentile(&self.hold_us, 95),
            hold_p99_us: percentile(&self.hold_us, 99),
            hold_max_us: self.hold_us.iter().copied().max().unwrap_or_default(),
            last_wait_us: self.wait_us.back().copied().unwrap_or_default(),
            last_hold_us: self.hold_us.back().copied().unwrap_or_default(),
        }
    }
}

pub(super) fn record_finished(
    metrics: &Arc<Mutex<WriterActorMetricState>>,
    wait: Duration,
    hold: Duration,
    failed: bool,
    kind: WorkspaceIndexPublicationKind,
    sdk_duration_us: Option<u64>,
    maintenance: Option<MaintenanceMetricSample>,
) {
    let Ok(mut metrics) = metrics.lock() else {
        return;
    };
    metrics.active = metrics.active.saturating_sub(1);
    metrics.sample_count = metrics.sample_count.saturating_add(1);
    metrics.failures = metrics.failures.saturating_add(u64::from(failed));
    record_content_metric(&mut metrics, kind, hold);
    if let Some(duration_us) = sdk_duration_us {
        metrics.sdk_publication_count = metrics.sdk_publication_count.saturating_add(1);
        metrics.sdk_publication_max_us = metrics.sdk_publication_max_us.max(duration_us);
    }
    if let Some(sample) = maintenance {
        record_maintenance_metric(&mut metrics, sample);
    }
    push_sample(&mut metrics.wait_us, wait);
    push_sample(&mut metrics.hold_us, hold);
}

fn record_content_metric(
    metrics: &mut WriterActorMetricState,
    kind: WorkspaceIndexPublicationKind,
    hold: Duration,
) {
    let duration_us = duration_us(hold);
    match kind {
        WorkspaceIndexPublicationKind::ContentCore => {
            metrics.content_core_publication_count += 1;
            metrics.content_core_publication_max_us =
                metrics.content_core_publication_max_us.max(duration_us);
        }
        WorkspaceIndexPublicationKind::ContentSubstring => {
            metrics.content_substring_publication_count += 1;
            metrics.content_substring_publication_max_us = metrics
                .content_substring_publication_max_us
                .max(duration_us);
        }
        WorkspaceIndexPublicationKind::Default => {}
    }
}

fn record_maintenance_metric(
    metrics: &mut WriterActorMetricState,
    sample: MaintenanceMetricSample,
) {
    metrics.maintenance_publication_count += 1;
    metrics.maintenance_publication_max_us = metrics
        .maintenance_publication_max_us
        .max(sample.duration_us);
    metrics.maintenance_optimize_count += u64::from(sample.optimized);
    metrics.maintenance_checkpoint_count += u64::from(sample.checkpointed);
    metrics.maintenance_incremental_vacuum_count += u64::from(sample.incremental_vacuumed);
    metrics.maintenance_copy_swap_count += u64::from(sample.copy_swapped);
    metrics.maintenance_copy_swap_deferred_count += u64::from(sample.copy_swap_deferred);
}

fn push_sample(samples: &mut VecDeque<u64>, duration: Duration) {
    if samples.len() == METRIC_SAMPLE_LIMIT {
        samples.pop_front();
    }
    samples.push_back(duration_us(duration));
}

fn duration_us(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

fn percentile(samples: &VecDeque<u64>, percentage: usize) -> u64 {
    let mut sorted = samples.iter().copied().collect::<Vec<_>>();
    sorted.sort_unstable();
    if sorted.is_empty() {
        return 0;
    }
    let index = (sorted.len() * percentage)
        .div_ceil(100)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[index]
}
