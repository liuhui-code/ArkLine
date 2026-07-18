use std::env;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::models::language::{SemanticSupervisorSnapshot, SemanticWorkerRuntime};

pub const SEMANTIC_MEMORY_LIMIT_MB_ENV: &str = "ARKLINE_SEMANTIC_MEMORY_LIMIT_MB";
const DEFAULT_MEMORY_LIMIT_MB: u64 = 1024;
const MIN_MEMORY_LIMIT_MB: u64 = 256;
const MAX_MEMORY_LIMIT_MB: u64 = 8192;
const BASE_RESTART_BACKOFF_MS: u64 = 250;
const MAX_RESTART_BACKOFF_MS: u64 = 30_000;

pub struct SemanticHostSupervisor {
    inner: Mutex<SupervisorState>,
    memory_budget_bytes: u64,
}

struct SupervisorState {
    status: &'static str,
    restart_count: u64,
    restored_document_count: u64,
    consecutive_failures: u32,
    last_heartbeat_epoch_ms: Option<u64>,
    last_heartbeat_instant: Option<Instant>,
    retry_not_before: Option<Instant>,
    last_error: Option<String>,
    runtime: Option<SemanticWorkerRuntime>,
}

impl SemanticHostSupervisor {
    pub fn new(memory_budget_bytes: u64) -> Self {
        Self {
            inner: Mutex::new(SupervisorState {
                status: "idle",
                restart_count: 0,
                restored_document_count: 0,
                consecutive_failures: 0,
                last_heartbeat_epoch_ms: None,
                last_heartbeat_instant: None,
                retry_not_before: None,
                last_error: None,
                runtime: None,
            }),
            memory_budget_bytes,
        }
    }

    pub fn ensure_start_allowed(&self) -> Result<(), String> {
        let state = self.inner.lock().map_err(lock_error)?;
        let remaining = retry_remaining_ms(state.retry_not_before);
        if remaining == 0 {
            Ok(())
        } else {
            Err(format!(
                "Semantic worker restart is backing off for {remaining} ms"
            ))
        }
    }

    pub fn mark_starting(&self, restart: bool) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        state.status = if restart { "restarting" } else { "starting" };
        if restart {
            state.restart_count = state.restart_count.saturating_add(1);
        }
        state.retry_not_before = None;
    }

    pub fn mark_running(&self, runtime: Option<SemanticWorkerRuntime>) -> bool {
        self.mark_heartbeat("running", runtime, false)
    }

    pub fn mark_success(&self, runtime: Option<SemanticWorkerRuntime>) -> bool {
        self.mark_heartbeat("running", runtime, true)
    }

    pub fn mark_restored(&self, restored_document_count: usize) {
        if let Ok(mut state) = self.inner.lock() {
            state.restored_document_count = restored_document_count as u64;
        }
    }

    pub fn should_probe_idle(&self, minimum_idle: Duration) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|state| state.last_heartbeat_instant)
            .is_some_and(|heartbeat| heartbeat.elapsed() >= minimum_idle)
    }

    pub fn mark_transient_failure(&self, error: &str) {
        self.mark_failure(error, false);
    }

    pub fn mark_terminal_failure(&self, error: &str) {
        self.mark_failure(error, true);
    }

    pub fn snapshot(&self) -> SemanticSupervisorSnapshot {
        let state = self.inner.lock().unwrap_or_else(|value| value.into_inner());
        SemanticSupervisorSnapshot {
            status: state.status.to_string(),
            restart_count: state.restart_count,
            restored_document_count: state.restored_document_count,
            consecutive_failures: state.consecutive_failures,
            last_heartbeat_epoch_ms: state.last_heartbeat_epoch_ms,
            retry_after_ms: retry_remaining_ms(state.retry_not_before),
            last_error: state.last_error.clone(),
            runtime: state.runtime,
            memory_budget_bytes: self.memory_budget_bytes,
        }
    }

    fn mark_heartbeat(
        &self,
        status: &'static str,
        runtime: Option<SemanticWorkerRuntime>,
        reset_failures: bool,
    ) -> bool {
        let Ok(mut state) = self.inner.lock() else {
            return false;
        };
        state.status = status;
        state.last_heartbeat_epoch_ms = Some(epoch_ms());
        state.last_heartbeat_instant = Some(Instant::now());
        state.retry_not_before = None;
        state.runtime = runtime.or(state.runtime);
        if reset_failures {
            state.consecutive_failures = 0;
            state.last_error = None;
        }
        let exceeded = state
            .runtime
            .is_some_and(|value| value.rss_bytes > self.memory_budget_bytes);
        if exceeded {
            state.status = "recycling";
            state.last_error = Some(format!(
                "Semantic worker RSS exceeded {} bytes",
                self.memory_budget_bytes
            ));
        }
        exceeded
    }

    fn mark_failure(&self, error: &str, backoff: bool) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        state.last_error = Some(error.to_string());
        if backoff {
            let delay = restart_backoff(state.consecutive_failures);
            state.status = "backoff";
            state.retry_not_before = Some(Instant::now() + delay);
        } else {
            state.status = "degraded";
        }
    }
}

pub fn semantic_memory_budget_bytes() -> u64 {
    let configured = env::var(SEMANTIC_MEMORY_LIMIT_MB_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_MEMORY_LIMIT_MB)
        .clamp(MIN_MEMORY_LIMIT_MB, MAX_MEMORY_LIMIT_MB);
    configured * 1024 * 1024
}

fn restart_backoff(failures: u32) -> Duration {
    let exponent = failures.saturating_sub(1).min(7);
    let delay = BASE_RESTART_BACKOFF_MS
        .saturating_mul(1_u64 << exponent)
        .min(MAX_RESTART_BACKOFF_MS);
    Duration::from_millis(delay)
}

fn retry_remaining_ms(deadline: Option<Instant>) -> u64 {
    deadline
        .and_then(|value| value.checked_duration_since(Instant::now()))
        .map(|value| value.as_millis().max(1) as u64)
        .unwrap_or(0)
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Semantic host supervisor lock is poisoned".to_string()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::SemanticHostSupervisor;
    use crate::models::language::SemanticWorkerRuntime;

    #[test]
    fn terminal_failures_enter_bounded_backoff() {
        let supervisor = SemanticHostSupervisor::new(1024);
        supervisor.mark_terminal_failure("crashed");

        let snapshot = supervisor.snapshot();
        assert_eq!(snapshot.status, "backoff");
        assert!(snapshot.retry_after_ms > 0);
        assert!(supervisor.ensure_start_allowed().is_err());
    }

    #[test]
    fn successful_response_clears_failure_state() {
        let supervisor = SemanticHostSupervisor::new(1024);
        supervisor.mark_terminal_failure("crashed");
        supervisor.mark_success(None);

        let snapshot = supervisor.snapshot();
        assert_eq!(snapshot.status, "running");
        assert_eq!(snapshot.consecutive_failures, 0);
        assert_eq!(snapshot.retry_after_ms, 0);
    }

    #[test]
    fn memory_pressure_requests_worker_recycling() {
        let supervisor = SemanticHostSupervisor::new(100);
        let exceeded = supervisor.mark_success(Some(SemanticWorkerRuntime {
            rss_bytes: 101,
            ..SemanticWorkerRuntime::default()
        }));

        assert!(exceeded);
        assert_eq!(supervisor.snapshot().status, "recycling");
    }

    #[test]
    fn idle_probe_requires_a_previous_heartbeat() {
        let supervisor = SemanticHostSupervisor::new(1024);
        assert!(!supervisor.should_probe_idle(Duration::ZERO));

        supervisor.mark_running(None);

        assert!(supervisor.should_probe_idle(Duration::ZERO));
    }
}
