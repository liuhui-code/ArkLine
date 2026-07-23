use crate::indexer_host::IndexerHostSession;
use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;
use std::time::{Duration, Instant};

const INITIAL_RESTART_BACKOFF: Duration = Duration::from_millis(250);
const MAX_RESTART_BACKOFF: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy)]
pub(super) enum IndexerRequestKind {
    Discovery,
    ContentRefresh,
    StubRefresh,
}

pub(super) struct IndexerHostLaneState {
    pub(super) session: Option<IndexerHostSession>,
    pub(super) in_flight: bool,
    pub(super) active_process_id: Option<u32>,
    pub(super) writer_metrics: Option<WorkspaceIndexWriterMetrics>,
    pub(super) slowest_publication: Option<WorkspaceIndexPublicationProfile>,
    restart_count: u64,
    consecutive_failures: u32,
    retry_not_before: Option<Instant>,
}

impl IndexerHostLaneState {
    fn new() -> Self {
        Self {
            session: None,
            in_flight: false,
            active_process_id: None,
            writer_metrics: None,
            slowest_publication: None,
            restart_count: 0,
            consecutive_failures: 0,
            retry_not_before: None,
        }
    }

    pub(super) fn process_id(&self) -> Option<u32> {
        self.session
            .as_ref()
            .map(IndexerHostSession::process_id)
            .or(self.active_process_id)
    }

    pub(super) fn reset(&mut self) {
        self.session = None;
        self.in_flight = false;
        self.active_process_id = None;
    }

    pub(super) fn is_backing_off(&self) -> bool {
        self.retry_not_before
            .is_some_and(|deadline| deadline > Instant::now())
    }

    pub(super) fn mark_starting(&mut self) {
        if self.consecutive_failures > 0 {
            self.restart_count = self.restart_count.saturating_add(1);
        }
    }

    pub(super) fn mark_success(&mut self) {
        self.consecutive_failures = 0;
        self.retry_not_before = None;
    }

    pub(super) fn record_publication(&mut self, profile: WorkspaceIndexPublicationProfile) {
        let should_replace = self.slowest_publication.as_ref().is_none_or(|current| {
            current.root_path != profile.root_path
                || profile.total_duration_us > current.total_duration_us
        });
        if should_replace {
            self.slowest_publication = Some(profile);
        }
    }

    pub(super) fn mark_failure(&mut self) {
        self.reset();
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.retry_not_before = Some(Instant::now() + restart_backoff(self.consecutive_failures));
    }

    pub(super) fn restart_count(&self) -> u64 {
        self.restart_count
    }

    pub(super) fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }

    pub(super) fn backoff_remaining(&self) -> Option<Duration> {
        self.retry_not_before
            .and_then(|deadline| deadline.checked_duration_since(Instant::now()))
    }
}

fn restart_backoff(failures: u32) -> Duration {
    let exponent = failures.saturating_sub(1).min(16);
    INITIAL_RESTART_BACKOFF
        .saturating_mul(1_u32 << exponent)
        .min(MAX_RESTART_BACKOFF)
}

pub(super) struct IndexerHostState {
    pub(super) status: &'static str,
    pub(super) discovery: IndexerHostLaneState,
    pub(super) content: IndexerHostLaneState,
    pub(super) stub: IndexerHostLaneState,
    pub(super) completed_discovery_chunks: u64,
    pub(super) completed_content_refresh_chunks: u64,
    pub(super) cancelled_content_refresh_chunks: u64,
    pub(super) completed_stub_refresh_chunks: u64,
    pub(super) cancelled_stub_refresh_chunks: u64,
    pub(super) fallback_count: u64,
    pub(super) last_error: Option<String>,
}

impl IndexerHostState {
    pub(super) fn new(enabled: bool) -> Self {
        Self {
            status: if enabled { "idle" } else { "disabled" },
            discovery: IndexerHostLaneState::new(),
            content: IndexerHostLaneState::new(),
            stub: IndexerHostLaneState::new(),
            completed_discovery_chunks: 0,
            completed_content_refresh_chunks: 0,
            cancelled_content_refresh_chunks: 0,
            completed_stub_refresh_chunks: 0,
            cancelled_stub_refresh_chunks: 0,
            fallback_count: 0,
            last_error: None,
        }
    }

    pub(super) fn lane(&self, kind: IndexerRequestKind) -> &IndexerHostLaneState {
        match kind {
            IndexerRequestKind::Discovery => &self.discovery,
            IndexerRequestKind::ContentRefresh => &self.content,
            IndexerRequestKind::StubRefresh => &self.stub,
        }
    }

    pub(super) fn lane_mut(&mut self, kind: IndexerRequestKind) -> &mut IndexerHostLaneState {
        match kind {
            IndexerRequestKind::Discovery => &mut self.discovery,
            IndexerRequestKind::ContentRefresh => &mut self.content,
            IndexerRequestKind::StubRefresh => &mut self.stub,
        }
    }

    pub(super) fn any_in_flight(&self) -> bool {
        self.discovery.in_flight || self.content.in_flight || self.stub.in_flight
    }

    pub(super) fn any_backing_off(&self) -> bool {
        self.discovery.is_backing_off()
            || self.content.is_backing_off()
            || self.stub.is_backing_off()
    }

    pub(super) fn visible_status(&self) -> &'static str {
        if self.any_in_flight() {
            "running"
        } else if self.any_backing_off() {
            "backoff"
        } else {
            self.status
        }
    }

    pub(super) fn primary_process_id(&self) -> Option<u32> {
        self.discovery
            .process_id()
            .or_else(|| self.content.process_id())
            .or_else(|| self.stub.process_id())
    }

    pub(super) fn restart_count(&self) -> u64 {
        self.discovery
            .restart_count()
            .saturating_add(self.content.restart_count())
            .saturating_add(self.stub.restart_count())
    }

    pub(super) fn consecutive_failure_count(&self) -> u32 {
        self.discovery
            .consecutive_failures()
            .max(self.content.consecutive_failures())
            .max(self.stub.consecutive_failures())
    }

    pub(super) fn backoff_remaining(&self) -> Option<Duration> {
        [
            self.discovery.backoff_remaining(),
            self.content.backoff_remaining(),
            self.stub.backoff_remaining(),
        ]
        .into_iter()
        .flatten()
        .max()
    }
}

#[cfg(test)]
mod tests {
    use super::IndexerHostLaneState;
    use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;

    #[test]
    fn slowest_publication_resets_when_workspace_changes() {
        let mut lane = IndexerHostLaneState::new();
        lane.record_publication(profile("/first", 100));
        lane.record_publication(profile("/first", 50));
        assert_eq!(
            lane.slowest_publication.as_ref().unwrap().total_duration_us,
            100
        );

        lane.record_publication(profile("/second", 10));

        let current = lane.slowest_publication.as_ref().unwrap();
        assert_eq!(current.root_path, "/second");
        assert_eq!(current.total_duration_us, 10);
    }

    fn profile(root_path: &str, total_duration_us: u64) -> WorkspaceIndexPublicationProfile {
        WorkspaceIndexPublicationProfile {
            root_path: root_path.to_string(),
            total_duration_us,
            stages: Vec::new(),
        }
    }
}

pub(super) fn validate_capabilities(capabilities: &[String]) -> Result<(), String> {
    for capability in [
        "discoveryChunk",
        "stubRefreshChunk",
        "contentRefreshChunk",
        "contentResourceBudget",
    ] {
        if !capabilities.iter().any(|value| value == capability) {
            return Err(format!("Indexer does not advertise {capability}"));
        }
    }
    Ok(())
}
