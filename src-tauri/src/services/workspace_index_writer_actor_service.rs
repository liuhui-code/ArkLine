use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[path = "workspace_index_foreground_read_service.rs"]
pub(crate) mod foreground_read;
#[path = "workspace_index_writer_maintenance_metric_service.rs"]
mod maintenance_metric;
#[path = "workspace_index_writer_actor_metric_service.rs"]
mod metric;
#[path = "workspace_index_writer_publication_service.rs"]
mod publication;

use self::foreground_read::{WorkspaceIndexForegroundReadGate, WorkspaceIndexForegroundReadGuard};
use self::maintenance_metric::maintenance_metric_sample;
use self::metric::{record_finished, WriterActorMetricState};
use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationArtifactDescriptor, WorkspaceIndexPublicationProfile,
};
use crate::services::workspace_index_publication_artifact_service::{
    recover_workspace_publication_staging, remove_workspace_publication_artifact,
    PUBLICATION_ARTIFACT_RECOVERY_GRACE,
};
use crate::services::workspace_index_publication_scheduler_service::{
    PublicationPriority, WorkspaceIndexPublicationQueue,
};
use publication::publish_artifact;

const PUBLICATION_QUEUE_CAPACITY: usize = 64;
const FOREGROUND_BURST_LIMIT: usize = 4;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);

pub(crate) struct WorkspaceIndexPublicationRequest {
    pub(crate) root_path: String,
    pub(crate) descriptor: WorkspaceIndexPublicationArtifactDescriptor,
    pub(crate) priority: PublicationPriority,
    pub(crate) kind: WorkspaceIndexPublicationKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexPublicationKind {
    Default,
    ContentCore,
    ContentSubstring,
}

impl WorkspaceIndexPublicationRequest {
    pub(crate) fn new(
        root_path: String,
        descriptor: WorkspaceIndexPublicationArtifactDescriptor,
        priority: PublicationPriority,
    ) -> Self {
        Self {
            root_path,
            descriptor,
            priority,
            kind: WorkspaceIndexPublicationKind::Default,
        }
    }

    pub(crate) fn content(
        root_path: String,
        descriptor: WorkspaceIndexPublicationArtifactDescriptor,
        priority: PublicationPriority,
        kind: WorkspaceIndexPublicationKind,
    ) -> Self {
        Self {
            root_path,
            descriptor,
            priority,
            kind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexPublicationAttempt {
    Applied(WorkspaceIndexPublicationProfile),
    Cancelled,
    Failed(String),
}

#[derive(Clone)]
pub(crate) struct WorkspaceIndexWriterActor {
    sender: SyncSender<PublicationEnvelope>,
    metrics: Arc<Mutex<WriterActorMetricState>>,
    foreground_reads: WorkspaceIndexForegroundReadGate,
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
        let foreground_reads = WorkspaceIndexForegroundReadGate::default();
        let worker_foreground_reads = foreground_reads.clone();
        std::thread::spawn(move || {
            run_writer_actor(receiver, worker_metrics, worker_foreground_reads)
        });
        Self {
            sender,
            metrics,
            foreground_reads,
        }
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

    pub(crate) fn publish_detached(
        &self,
        request: WorkspaceIndexPublicationRequest,
    ) -> Result<(), String> {
        self.recover_workspace_once(&request.root_path);
        let (response, _response_rx) = mpsc::channel();
        let envelope = PublicationEnvelope {
            request,
            queued_at: Instant::now(),
            cancelled: Arc::new(AtomicBool::new(false)),
            started: Arc::new(AtomicBool::new(false)),
            response,
        };
        self.enqueue(envelope, &mut || false)
            .map_err(|attempt| match attempt {
                WorkspaceIndexPublicationAttempt::Failed(error) => error,
                WorkspaceIndexPublicationAttempt::Cancelled => {
                    "Detached workspace publication was cancelled".to_string()
                }
                WorkspaceIndexPublicationAttempt::Applied(_) => {
                    "Detached workspace publication returned an invalid enqueue state".to_string()
                }
            })
    }

    pub(crate) fn begin_foreground_read(&self) -> WorkspaceIndexForegroundReadGuard {
        self.foreground_reads.begin()
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
    foreground_reads: WorkspaceIndexForegroundReadGate,
) {
    let mut queue = WorkspaceIndexPublicationQueue::with_capacity(
        FOREGROUND_BURST_LIMIT,
        PUBLICATION_QUEUE_CAPACITY,
    );
    while let Ok(envelope) = receiver.recv() {
        queue.push(envelope.request.priority, envelope);
        drain_ingress(&receiver, &mut queue);
        while let Some(envelope) = queue.pop() {
            // An idle task is selected only after higher-priority work already in the queue.
            // Do not sleep here waiting for hypothetical work: that blocks the sole SQLite writer
            // and turns every subsequent background publication into a multi-second queue wait.
            foreground_reads.yield_background(envelope.request.priority, &envelope.cancelled);
            process_envelope(envelope, &metrics);
            drain_ingress(&receiver, &mut queue);
        }
    }
}

fn drain_ingress(
    receiver: &Receiver<PublicationEnvelope>,
    queue: &mut WorkspaceIndexPublicationQueue<PublicationEnvelope>,
) {
    while !queue.is_full() {
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
    let retain_artifact =
        result.is_ok() && envelope.request.kind == WorkspaceIndexPublicationKind::ContentCore;
    if !retain_artifact {
        remove_workspace_publication_artifact(&envelope.request.descriptor);
    }
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
        envelope.request.kind,
        sdk_duration_us,
        maintenance_sample,
    );
    let _ = envelope.response.send(result);
}

#[cfg(test)]
#[path = "workspace_index_writer_actor_compaction_tests.rs"]
mod compaction_tests;
#[cfg(test)]
#[path = "workspace_index_writer_content_layer_tests.rs"]
mod content_layer_tests;
#[cfg(test)]
#[path = "workspace_index_writer_actor_service_tests.rs"]
mod tests;
