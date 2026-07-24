use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationArtifactDescriptor, WorkspaceIndexPublicationProfile,
};
use crate::services::workspace_content_refresh_chunk_service::publish_prepared_workspace_content_refresh_chunk;
use crate::services::workspace_discovery_runner_service::publish_prepared_workspace_discovery_chunk;
use crate::services::workspace_index_maintenance_publication_service::publish_workspace_index_maintenance;
use crate::services::workspace_index_publication_artifact_service::{
    read_workspace_publication_artifact, recover_workspace_publication_staging,
    remove_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
    PUBLICATION_ARTIFACT_RECOVERY_GRACE,
};
use crate::services::workspace_index_publication_scheduler_service::{
    PublicationPriority, WorkspaceIndexPublicationQueue,
};
use crate::services::workspace_sdk_index_service::publish_prepared_workspace_sdk_catalog_chunk;
use crate::services::workspace_stub_refresh_chunk_service::publish_prepared_workspace_stub_refresh_chunk;

const PUBLICATION_QUEUE_CAPACITY: usize = 64;
const FOREGROUND_BURST_LIMIT: usize = 4;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);
const METRIC_SAMPLE_LIMIT: usize = 128;

pub(crate) struct WorkspaceIndexPublicationRequest {
    pub(crate) root_path: String,
    pub(crate) descriptor: WorkspaceIndexPublicationArtifactDescriptor,
    pub(crate) priority: PublicationPriority,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexPublicationAttempt {
    Applied(WorkspaceIndexPublicationProfile),
    Cancelled,
    Failed(String),
}

pub(crate) struct WorkspaceIndexWriterActor {
    sender: SyncSender<PublicationEnvelope>,
    metrics: Arc<Mutex<WriterActorMetricState>>,
}

struct PublicationEnvelope {
    request: WorkspaceIndexPublicationRequest,
    queued_at: Instant,
    cancelled: Arc<AtomicBool>,
    started: Arc<AtomicBool>,
    response: mpsc::Sender<Result<WorkspaceIndexPublicationProfile, String>>,
}

impl WorkspaceIndexWriterActor {
    pub(crate) fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel(PUBLICATION_QUEUE_CAPACITY);
        let metrics = Arc::new(Mutex::new(WriterActorMetricState::default()));
        let worker_metrics = Arc::clone(&metrics);
        std::thread::spawn(move || run_writer_actor(receiver, worker_metrics));
        Self { sender, metrics }
    }

    pub(crate) fn shared() -> Self {
        static ACTOR: OnceLock<WorkspaceIndexWriterActor> = OnceLock::new();
        ACTOR.get_or_init(Self::new).clone()
    }

    pub(crate) fn publish<F>(
        &self,
        request: WorkspaceIndexPublicationRequest,
        mut is_cancelled: F,
    ) -> WorkspaceIndexPublicationAttempt
    where
        F: FnMut() -> bool,
    {
        self.recover_workspace_once(&request.root_path);
        let cancelled = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let (response, response_rx) = mpsc::channel();
        let envelope = PublicationEnvelope {
            request,
            queued_at: Instant::now(),
            cancelled: Arc::clone(&cancelled),
            started: Arc::clone(&started),
            response,
        };
        if let Err(error) = self.enqueue(envelope, &mut is_cancelled) {
            return error;
        }
        loop {
            match response_rx.recv_timeout(CANCELLATION_POLL_INTERVAL) {
                Ok(Ok(profile)) => return WorkspaceIndexPublicationAttempt::Applied(profile),
                Ok(Err(error)) => return WorkspaceIndexPublicationAttempt::Failed(error),
                Err(RecvTimeoutError::Disconnected) => {
                    return WorkspaceIndexPublicationAttempt::Failed(
                        "Workspace index writer actor disconnected".to_string(),
                    );
                }
                Err(RecvTimeoutError::Timeout)
                    if is_cancelled() && !started.load(Ordering::SeqCst) =>
                {
                    cancelled.store(true, Ordering::SeqCst);
                    return WorkspaceIndexPublicationAttempt::Cancelled;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    pub(crate) fn snapshot(&self) -> WorkspaceIndexWriterMetrics {
        self.metrics
            .lock()
            .map(|metrics| metrics.snapshot())
            .unwrap_or_default()
    }

    fn recover_workspace_once(&self, root_path: &str) {
        let should_recover = self
            .metrics
            .lock()
            .map(|mut metrics| metrics.recovered_roots.insert(root_path.to_string()))
            .unwrap_or(false);
        if !should_recover {
            return;
        }
        let report =
            recover_workspace_publication_staging(root_path, PUBLICATION_ARTIFACT_RECOVERY_GRACE);
        let Ok(mut metrics) = self.metrics.lock() else {
            return;
        };
        metrics.recovery_workspace_count = metrics.recovery_workspace_count.saturating_add(1);
        match report {
            Ok(report) => {
                metrics.orphan_artifact_scanned_count = metrics
                    .orphan_artifact_scanned_count
                    .saturating_add(report.scanned_count);
                metrics.orphan_artifact_removed_count = metrics
                    .orphan_artifact_removed_count
                    .saturating_add(report.removed_count);
                metrics.orphan_artifact_retained_count = metrics
                    .orphan_artifact_retained_count
                    .saturating_add(report.retained_count);
                metrics.recovery_failure_count = metrics
                    .recovery_failure_count
                    .saturating_add(report.failure_count);
            }
            Err(_) => {
                metrics.recovery_failure_count = metrics.recovery_failure_count.saturating_add(1);
            }
        }
    }

    fn enqueue<F>(
        &self,
        mut envelope: PublicationEnvelope,
        is_cancelled: &mut F,
    ) -> Result<(), WorkspaceIndexPublicationAttempt>
    where
        F: FnMut() -> bool,
    {
        loop {
            if is_cancelled() {
                remove_workspace_publication_artifact(&envelope.request.descriptor);
                return Err(WorkspaceIndexPublicationAttempt::Cancelled);
            }
            let send_result = {
                let mut metrics = self.metrics.lock().map_err(|_| {
                    WorkspaceIndexPublicationAttempt::Failed(
                        "Workspace index writer metrics lock poisoned".to_string(),
                    )
                })?;
                let result = self.sender.try_send(envelope);
                if result.is_ok() {
                    metrics.queued = metrics.queued.saturating_add(1);
                }
                result
            };
            match send_result {
                Ok(()) => {
                    return Ok(());
                }
                Err(TrySendError::Full(returned)) => {
                    envelope = returned;
                    std::thread::sleep(CANCELLATION_POLL_INTERVAL);
                }
                Err(TrySendError::Disconnected(returned)) => {
                    remove_workspace_publication_artifact(&returned.request.descriptor);
                    return Err(WorkspaceIndexPublicationAttempt::Failed(
                        "Workspace index writer actor is unavailable".to_string(),
                    ));
                }
            }
        }
    }
}

fn run_writer_actor(
    receiver: Receiver<PublicationEnvelope>,
    metrics: Arc<Mutex<WriterActorMetricState>>,
) {
    let mut queue = WorkspaceIndexPublicationQueue::new(FOREGROUND_BURST_LIMIT);
    while let Ok(envelope) = receiver.recv() {
        queue.push(envelope.request.priority, envelope);
        drain_ingress(&receiver, &mut queue);
        while let Some(envelope) = queue.pop() {
            process_envelope(envelope, &metrics);
            drain_ingress(&receiver, &mut queue);
        }
    }
}

fn drain_ingress(
    receiver: &Receiver<PublicationEnvelope>,
    queue: &mut WorkspaceIndexPublicationQueue<PublicationEnvelope>,
) {
    loop {
        match receiver.try_recv() {
            Ok(envelope) => queue.push(envelope.request.priority, envelope),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        }
    }
}

fn process_envelope(envelope: PublicationEnvelope, metrics: &Arc<Mutex<WriterActorMetricState>>) {
    let wait = envelope.queued_at.elapsed();
    if let Ok(mut current) = metrics.lock() {
        current.queued = current.queued.saturating_sub(1);
        if !envelope.cancelled.load(Ordering::SeqCst) {
            current.active = current.active.saturating_add(1);
        }
    }
    if envelope.cancelled.load(Ordering::SeqCst) {
        remove_workspace_publication_artifact(&envelope.request.descriptor);
        return;
    }
    envelope.started.store(true, Ordering::SeqCst);
    let started = Instant::now();
    let result = publish_artifact(&envelope.request);
    let hold = started.elapsed();
    remove_workspace_publication_artifact(&envelope.request.descriptor);
    let sdk_duration_us = result
        .as_ref()
        .ok()
        .filter(|profile| {
            profile
                .stages
                .iter()
                .any(|stage| stage.name == "sdkCatalogCommit")
        })
        .map(|profile| profile.total_duration_us);
    let maintenance_sample = result.as_ref().ok().and_then(maintenance_metric_sample);
    record_finished(
        metrics,
        wait,
        hold,
        result.is_err(),
        sdk_duration_us,
        maintenance_sample,
    );
    let _ = envelope.response.send(result);
}

fn publish_artifact(
    request: &WorkspaceIndexPublicationRequest,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    match read_workspace_publication_artifact(&request.root_path, &request.descriptor)? {
        WorkspaceIndexPublicationArtifact::Discovery {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_discovery_chunk(&prepared)
        }
        WorkspaceIndexPublicationArtifact::Discovery { .. } => {
            Err("Discovery publication artifact root did not match the request".to_string())
        }
        WorkspaceIndexPublicationArtifact::SdkCatalog {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_sdk_catalog_chunk(&prepared)
        }
        WorkspaceIndexPublicationArtifact::SdkCatalog { .. } => {
            Err("SDK publication artifact root did not match the request".to_string())
        }
        WorkspaceIndexPublicationArtifact::Content {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_content_refresh_chunk(&root_path, &prepared)
        }
        WorkspaceIndexPublicationArtifact::Content { .. } => {
            Err("Content publication artifact root did not match the request".to_string())
        }
        WorkspaceIndexPublicationArtifact::Stub {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_stub_refresh_chunk(&root_path, &prepared)
        }
        WorkspaceIndexPublicationArtifact::Stub { .. } => {
            Err("Stub publication artifact root did not match the request".to_string())
        }
        WorkspaceIndexPublicationArtifact::Maintenance {
            root_path,
            operation,
        } if root_path == request.root_path => {
            publish_workspace_index_maintenance(&root_path, operation)
        }
        WorkspaceIndexPublicationArtifact::Maintenance { .. } => {
            Err("Maintenance publication artifact root did not match the request".to_string())
        }
    }
}

#[derive(Default)]
struct WriterActorMetricState {
    sample_count: u64,
    queued: usize,
    active: usize,
    failures: u64,
    recovered_roots: HashSet<String>,
    recovery_workspace_count: u64,
    orphan_artifact_scanned_count: u64,
    orphan_artifact_removed_count: u64,
    orphan_artifact_retained_count: u64,
    recovery_failure_count: u64,
    sdk_publication_count: u64,
    sdk_publication_max_us: u64,
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
    fn snapshot(&self) -> WorkspaceIndexWriterMetrics {
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

fn record_finished(
    metrics: &Arc<Mutex<WriterActorMetricState>>,
    wait: Duration,
    hold: Duration,
    failed: bool,
    sdk_duration_us: Option<u64>,
    maintenance_sample: Option<MaintenanceMetricSample>,
) {
    let Ok(mut metrics) = metrics.lock() else {
        return;
    };
    metrics.active = metrics.active.saturating_sub(1);
    metrics.sample_count = metrics.sample_count.saturating_add(1);
    metrics.failures = metrics.failures.saturating_add(u64::from(failed));
    if let Some(duration_us) = sdk_duration_us {
        metrics.sdk_publication_count = metrics.sdk_publication_count.saturating_add(1);
        metrics.sdk_publication_max_us = metrics.sdk_publication_max_us.max(duration_us);
    }
    if let Some(sample) = maintenance_sample {
        metrics.maintenance_publication_count =
            metrics.maintenance_publication_count.saturating_add(1);
        metrics.maintenance_publication_max_us = metrics
            .maintenance_publication_max_us
            .max(sample.duration_us);
        metrics.maintenance_optimize_count = metrics
            .maintenance_optimize_count
            .saturating_add(u64::from(sample.optimized));
        metrics.maintenance_checkpoint_count = metrics
            .maintenance_checkpoint_count
            .saturating_add(u64::from(sample.checkpointed));
        metrics.maintenance_incremental_vacuum_count = metrics
            .maintenance_incremental_vacuum_count
            .saturating_add(u64::from(sample.incremental_vacuumed));
        metrics.maintenance_copy_swap_count = metrics
            .maintenance_copy_swap_count
            .saturating_add(u64::from(sample.copy_swapped));
        metrics.maintenance_copy_swap_deferred_count = metrics
            .maintenance_copy_swap_deferred_count
            .saturating_add(u64::from(sample.copy_swap_deferred));
    }
    push_sample(&mut metrics.wait_us, wait);
    push_sample(&mut metrics.hold_us, hold);
}

#[derive(Clone, Copy)]
struct MaintenanceMetricSample {
    duration_us: u64,
    optimized: bool,
    checkpointed: bool,
    incremental_vacuumed: bool,
    copy_swapped: bool,
    copy_swap_deferred: bool,
}

fn maintenance_metric_sample(
    profile: &WorkspaceIndexPublicationProfile,
) -> Option<MaintenanceMetricSample> {
    let maintenance = profile
        .stages
        .iter()
        .any(|stage| stage.name.starts_with("maintenance"));
    maintenance.then(|| MaintenanceMetricSample {
        duration_us: profile.total_duration_us,
        optimized: profile
            .stages
            .iter()
            .any(|stage| stage.name.contains("Optimize")),
        checkpointed: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceTruncateCheckpoint"),
        incremental_vacuumed: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceIncrementalVacuum"),
        copy_swapped: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceCopySwapCommit"),
        copy_swap_deferred: profile
            .stages
            .iter()
            .any(|stage| stage.name.starts_with("maintenanceCopySwapDeferred")),
    })
}

impl Clone for WorkspaceIndexWriterActor {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            metrics: Arc::clone(&self.metrics),
        }
    }
}

fn push_sample(samples: &mut VecDeque<u64>, duration: Duration) {
    if samples.len() == METRIC_SAMPLE_LIMIT {
        samples.pop_front();
    }
    samples.push_back(u64::try_from(duration.as_micros()).unwrap_or(u64::MAX));
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

#[cfg(test)]
#[path = "workspace_index_writer_actor_compaction_tests.rs"]
mod compaction_tests;
#[cfg(test)]
#[path = "workspace_index_writer_actor_service_tests.rs"]
mod tests;
