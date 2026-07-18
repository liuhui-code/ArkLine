use std::env;
use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::indexer_host::{discover_indexer_executable, IndexerHostSession};
use crate::indexer_sidecar::{IndexerDiscoveryResult, IndexerStubRefreshResult, IndexerTaskKey};
use crate::models::workspace_index_diagnostics::WorkspaceIndexerHostSnapshot;

use super::runtime_state::{validate_capabilities, IndexerHostState, IndexerRequestKind};
use super::session::is_cancelled_error;

pub const ARKLINE_INDEXER_ENABLED_ENV: &str = "ARKLINE_INDEXER_ENABLED";

pub struct IndexerHostRuntime {
    pub(super) enabled: bool,
    executable_path: Option<PathBuf>,
    state: Mutex<IndexerHostState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexerStubRefreshAttempt {
    Applied(IndexerStubRefreshResult),
    Unavailable,
    Cancelled,
}

impl Default for IndexerHostRuntime {
    fn default() -> Self {
        let enabled = env::var(ARKLINE_INDEXER_ENABLED_ENV)
            .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
        let discovery = discover_indexer_executable();
        Self::new(enabled, discovery.executable_path)
    }
}

impl fmt::Debug for IndexerHostRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IndexerHostRuntime")
            .field("snapshot", &self.snapshot())
            .finish()
    }
}

impl IndexerHostRuntime {
    pub fn with_executable(executable_path: PathBuf) -> Self {
        Self::new(true, Some(executable_path))
    }

    fn new(enabled: bool, executable_path: Option<PathBuf>) -> Self {
        Self {
            enabled,
            executable_path,
            state: Mutex::new(IndexerHostState::new(enabled)),
        }
    }

    pub fn discover_workspace_chunk(
        &self,
        task: IndexerTaskKey,
        pending_directories: Option<Vec<String>>,
        limit: usize,
    ) -> Option<IndexerDiscoveryResult> {
        if !self.enabled {
            return None;
        }
        let mut session = match self.checkout_session(IndexerRequestKind::Discovery) {
            Ok(Some(session)) => session,
            Ok(None) => return None,
            Err(error) => {
                self.finish_failure(IndexerRequestKind::Discovery, error);
                return None;
            }
        };
        let result = session.discover_workspace_chunk(task, pending_directories, limit);
        match result {
            Ok(result) => {
                self.finish_success(session, IndexerRequestKind::Discovery);
                Some(result)
            }
            Err(error) => {
                self.finish_failure(IndexerRequestKind::Discovery, error);
                None
            }
        }
    }

    pub fn snapshot(&self) -> WorkspaceIndexerHostSnapshot {
        let state = self.state.lock().unwrap_or_else(|value| value.into_inner());
        WorkspaceIndexerHostSnapshot {
            enabled: self.enabled,
            status: state.visible_status().to_string(),
            process_id: state.primary_process_id(),
            discovery_process_id: state.discovery.process_id(),
            content_process_id: state.content.process_id(),
            stub_process_id: state.stub.process_id(),
            discovery_writer_metrics: state.discovery.writer_metrics.clone(),
            content_writer_metrics: state.content.writer_metrics.clone(),
            stub_writer_metrics: state.stub.writer_metrics.clone(),
            completed_discovery_chunks: state.completed_discovery_chunks,
            completed_content_refresh_chunks: state.completed_content_refresh_chunks,
            cancelled_content_refresh_chunks: state.cancelled_content_refresh_chunks,
            completed_stub_refresh_chunks: state.completed_stub_refresh_chunks,
            cancelled_stub_refresh_chunks: state.cancelled_stub_refresh_chunks,
            fallback_count: state.fallback_count,
            restart_count: state.restart_count(),
            consecutive_failure_count: state.consecutive_failure_count(),
            backoff_remaining_ms: state
                .backoff_remaining()
                .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)),
            last_error: state.last_error.clone(),
        }
    }

    pub fn refresh_stub_chunk<F>(
        &self,
        task: IndexerTaskKey,
        indexed_generation: u64,
        changed_paths: Vec<String>,
        removed_paths: Vec<String>,
        is_cancelled: F,
    ) -> IndexerStubRefreshAttempt
    where
        F: FnMut() -> bool,
    {
        if !self.enabled {
            return IndexerStubRefreshAttempt::Unavailable;
        }
        let mut session = match self.checkout_session(IndexerRequestKind::StubRefresh) {
            Ok(Some(session)) => session,
            Ok(None) => return IndexerStubRefreshAttempt::Unavailable,
            Err(error) => {
                self.finish_failure(IndexerRequestKind::StubRefresh, error);
                return IndexerStubRefreshAttempt::Unavailable;
            }
        };
        let result = session.refresh_stub_chunk(
            task,
            indexed_generation,
            changed_paths,
            removed_paths,
            is_cancelled,
        );
        match result {
            Ok(result) => {
                self.finish_success(session, IndexerRequestKind::StubRefresh);
                IndexerStubRefreshAttempt::Applied(result)
            }
            Err(error) if is_cancelled_error(&error) => {
                self.finish_cancelled(IndexerRequestKind::StubRefresh);
                IndexerStubRefreshAttempt::Cancelled
            }
            Err(error) => {
                self.finish_failure(IndexerRequestKind::StubRefresh, error);
                IndexerStubRefreshAttempt::Unavailable
            }
        }
    }

    pub(super) fn checkout_session(
        &self,
        kind: IndexerRequestKind,
    ) -> Result<Option<IndexerHostSession>, String> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Indexer host state lock poisoned".to_string())?;
            if state.lane(kind).in_flight {
                return Ok(None);
            }
            if state.lane(kind).is_backing_off() {
                return Ok(None);
            }
            state.status = "running";
            let lane = state.lane_mut(kind);
            lane.mark_starting();
            lane.in_flight = true;
            if let Some(session) = lane.session.take() {
                lane.active_process_id = Some(session.process_id());
                return Ok(Some(session));
            }
        }

        let executable = self
            .executable_path
            .as_deref()
            .ok_or_else(|| "Indexer executable is unavailable".to_string())?;
        let mut session = IndexerHostSession::start(executable)?;
        if let Ok(mut state) = self.state.lock() {
            state.lane_mut(kind).active_process_id = Some(session.process_id());
        }
        let capabilities = session.health()?;
        validate_capabilities(&capabilities)?;
        Ok(Some(session))
    }

    pub(super) fn finish_success(&self, session: IndexerHostSession, kind: IndexerRequestKind) {
        let writer_metrics = session.writer_metrics().cloned();
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let lane = state.lane_mut(kind);
        lane.in_flight = false;
        lane.active_process_id = None;
        lane.mark_success();
        if writer_metrics.is_some() {
            lane.writer_metrics = writer_metrics;
        }
        lane.session = Some(session);
        match kind {
            IndexerRequestKind::Discovery => {
                state.completed_discovery_chunks =
                    state.completed_discovery_chunks.saturating_add(1);
            }
            IndexerRequestKind::ContentRefresh => {
                state.completed_content_refresh_chunks =
                    state.completed_content_refresh_chunks.saturating_add(1);
            }
            IndexerRequestKind::StubRefresh => {
                state.completed_stub_refresh_chunks =
                    state.completed_stub_refresh_chunks.saturating_add(1);
            }
        }
        state.status = if state.any_in_flight() {
            "running"
        } else {
            "idle"
        };
    }

    pub(super) fn finish_failure(&self, kind: IndexerRequestKind, error: String) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.lane_mut(kind).mark_failure();
        state.fallback_count = state.fallback_count.saturating_add(1);
        state.last_error = Some(error);
        state.status = if state.any_in_flight() {
            "running"
        } else {
            "fallback"
        };
    }

    pub(super) fn finish_cancelled(&self, kind: IndexerRequestKind) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let lane = state.lane_mut(kind);
        lane.reset();
        lane.mark_success();
        match kind {
            IndexerRequestKind::ContentRefresh => {
                state.cancelled_content_refresh_chunks =
                    state.cancelled_content_refresh_chunks.saturating_add(1);
            }
            IndexerRequestKind::StubRefresh => {
                state.cancelled_stub_refresh_chunks =
                    state.cancelled_stub_refresh_chunks.saturating_add(1);
            }
            IndexerRequestKind::Discovery => {}
        }
        state.status = if state.any_in_flight() {
            "running"
        } else {
            "idle"
        };
    }

    pub(crate) fn supports_parallel_deep_refresh(&self) -> bool {
        self.enabled
            && self
                .executable_path
                .as_ref()
                .is_some_and(|path| path.is_file())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use super::{IndexerHostRuntime, IndexerStubRefreshAttempt};
    use crate::indexer_sidecar::{IndexerTaskKey, INDEXER_PROTOCOL_VERSION};

    #[test]
    fn snapshot_does_not_wait_for_a_slow_sidecar_request() {
        let root = std::env::temp_dir().join(format!(
            "arkline-indexer-runtime-lock-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("slow-indexer.sh");
        let root_path = root.to_string_lossy().to_string();
        let task = IndexerTaskKey {
            root_path: root_path.clone(),
            kind: "stub-refresh".to_string(),
            generation: 1,
            reason: "lock-test".to_string(),
        };
        let health = serde_json::json!({
            "id": "indexer-health-1",
            "ok": true,
            "payload": {
                "status": "ready",
                "protocolVersion": INDEXER_PROTOCOL_VERSION,
                "capabilities": ["health", "discoveryChunk", "contentRefreshChunk", "contentResourceBudget", "stubRefreshChunk"]
            }
        });
        let response = serde_json::json!({
            "id": "indexer-refreshStubChunk-2",
            "ok": true,
            "payload": {
                "task": task,
                "indexedGeneration": 1,
                "changedPathCount": 1,
                "removedPathCount": 0,
                "parsedFileCount": 1,
                "parseErrorCount": 0
            },
            "telemetry": {
                "writerMetrics": {
                    "sampleCount": 3,
                    "activeWriterCount": 0,
                    "queuedWriterCount": 0,
                    "failureCount": 0,
                    "waitP50Us": 10,
                    "waitP95Us": 20,
                    "waitP99Us": 20,
                    "waitMaxUs": 20,
                    "holdP50Us": 100,
                    "holdP95Us": 200,
                    "holdP99Us": 200,
                    "holdMaxUs": 200,
                    "lastWaitUs": 10,
                    "lastHoldUs": 100
                }
            }
        });
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\nread line\nprintf '%s\\n' '{}'\nread line\nsleep 1\nprintf '%s\\n' '{}'\n",
                health, response
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        let runtime = Arc::new(IndexerHostRuntime::with_executable(executable));
        let worker_runtime = runtime.clone();
        let worker_task = task.clone();
        let source = format!("{root_path}/Entry.ets");
        let worker = thread::spawn(move || {
            worker_runtime.refresh_stub_chunk(worker_task, 1, vec![source], Vec::new(), || false)
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while runtime.snapshot().process_id.is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }

        let started = Instant::now();
        let snapshot = runtime.snapshot();
        let elapsed = started.elapsed();

        assert_eq!(snapshot.status, "running");
        assert!(snapshot.process_id.is_some());
        assert!(elapsed < Duration::from_millis(100));
        assert!(matches!(
            worker.join().unwrap(),
            IndexerStubRefreshAttempt::Applied(_)
        ));
        let completed = runtime.snapshot();
        assert_eq!(
            completed
                .stub_writer_metrics
                .as_ref()
                .map(|metrics| metrics.sample_count),
            Some(3)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancelling_a_slow_stub_request_kills_the_process_without_counting_fallback() {
        let root = std::env::temp_dir().join(format!(
            "arkline-indexer-runtime-cancel-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("slow-indexer.sh");
        let root_path = root.to_string_lossy().to_string();
        let task = IndexerTaskKey {
            root_path: root_path.clone(),
            kind: "stub-refresh".to_string(),
            generation: 2,
            reason: "cancel-test".to_string(),
        };
        let health = serde_json::json!({
            "id": "indexer-health-1",
            "ok": true,
            "payload": {
                "status": "ready",
                "protocolVersion": INDEXER_PROTOCOL_VERSION,
                "capabilities": ["health", "discoveryChunk", "contentRefreshChunk", "contentResourceBudget", "stubRefreshChunk"]
            }
        });
        let response = serde_json::json!({
            "id": "indexer-refreshStubChunk-2",
            "ok": true,
            "payload": {
                "task": task,
                "indexedGeneration": 2,
                "changedPathCount": 1,
                "removedPathCount": 0,
                "parsedFileCount": 1,
                "parseErrorCount": 0
            }
        });
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\nread line\nprintf '%s\\n' '{}'\nread line\nsleep 1\nprintf '%s\\n' '{}'\n",
                health, response
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        let runtime = Arc::new(IndexerHostRuntime::with_executable(executable));
        let cancelled = Arc::new(AtomicBool::new(false));
        let polling_started = Arc::new(AtomicBool::new(false));
        let worker_runtime = runtime.clone();
        let worker_cancelled = cancelled.clone();
        let worker_polling_started = polling_started.clone();
        let worker_task = task.clone();
        let source = format!("{root_path}/Entry.ets");
        let worker = thread::spawn(move || {
            worker_runtime.refresh_stub_chunk(worker_task, 2, vec![source], Vec::new(), || {
                worker_polling_started.store(true, Ordering::SeqCst);
                worker_cancelled.load(Ordering::SeqCst)
            })
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !polling_started.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(polling_started.load(Ordering::SeqCst));
        assert!(runtime.snapshot().process_id.is_some());

        let cancel_started = Instant::now();
        cancelled.store(true, Ordering::SeqCst);
        assert_eq!(worker.join().unwrap(), IndexerStubRefreshAttempt::Cancelled);
        assert!(cancel_started.elapsed() < Duration::from_millis(500));
        let cancelled_snapshot = runtime.snapshot();
        assert_eq!(cancelled_snapshot.status, "idle");
        assert_eq!(cancelled_snapshot.cancelled_stub_refresh_chunks, 1);
        assert_eq!(cancelled_snapshot.fallback_count, 0);
        assert!(cancelled_snapshot.process_id.is_none());

        let restarted = runtime.refresh_stub_chunk(
            task,
            2,
            vec![format!("{root_path}/Entry.ets")],
            Vec::new(),
            || false,
        );
        assert!(matches!(restarted, IndexerStubRefreshAttempt::Applied(_)));
        let restarted_snapshot = runtime.snapshot();
        assert_eq!(restarted_snapshot.completed_stub_refresh_chunks, 1);
        assert_eq!(restarted_snapshot.cancelled_stub_refresh_chunks, 1);
        assert_eq!(restarted_snapshot.fallback_count, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
