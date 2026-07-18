use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::config::SemanticHostConfig;
use super::generation_tracker::SemanticDocumentGenerationTracker;
use super::launcher::{direct_semantic_worker_launcher, SharedSemanticWorkerLauncher};
use super::process::SemanticWorkerDiscovery;
use super::sdk::{discover_harmony_sdk, SdkDiscovery};
use super::session::SemanticWorkerSession;
use super::supervisor::{semantic_memory_budget_bytes, SemanticHostSupervisor};
use crate::models::language::SemanticSupervisorSnapshot;

mod watchdog;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticHostReadiness {
    config: SemanticHostConfig,
    pub sdk: SdkDiscovery,
    pub worker: SemanticWorkerDiscovery,
}

pub struct SemanticHostManager {
    readiness: SemanticHostReadiness,
    launcher: SharedSemanticWorkerLauncher,
    session: Mutex<Option<Arc<SemanticWorkerSession>>>,
    document_generations: Arc<Mutex<SemanticDocumentGenerationTracker>>,
    supervisor: SemanticHostSupervisor,
}

impl SemanticHostReadiness {
    pub fn discover(config: SemanticHostConfig) -> Self {
        Self::discover_with_launcher(config, direct_semantic_worker_launcher())
    }

    pub fn discover_with_launcher(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
    ) -> Self {
        Self {
            sdk: discover_harmony_sdk(config.harmony_sdk_env_value().as_deref()),
            worker: launcher.discover(&config),
            config,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.worker.entry_path.is_some()
            && (self.worker.standalone || self.worker.node_path.is_some())
    }

    pub fn has_sdk(&self) -> bool {
        matches!(self.sdk, SdkDiscovery::Ready(_))
    }

    pub fn sdk_path(&self) -> Option<&PathBuf> {
        match &self.sdk {
            SdkDiscovery::Ready(path) => Some(path),
            SdkDiscovery::Missing => None,
        }
    }

    pub fn detail(&self) -> String {
        let sdk_detail = match self.sdk_path() {
            Some(path) => format!("SDK ready at {}", path.display()),
            None => "HarmonyOS SDK path is not configured; independent semantic worker mode remains available".to_string(),
        };

        if self.is_ready() {
            return format!("{sdk_detail}; {}", self.worker.detail);
        }

        format!("{sdk_detail}; {}", self.worker.detail)
    }
}

impl SemanticHostManager {
    pub fn discover(config: SemanticHostConfig) -> Self {
        Self::discover_with_launcher(config, direct_semantic_worker_launcher())
    }

    pub fn discover_with_launcher(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
    ) -> Self {
        Self::discover_with_launcher_and_budget(config, launcher, semantic_memory_budget_bytes())
    }

    fn discover_with_launcher_and_budget(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
        memory_budget_bytes: u64,
    ) -> Self {
        Self {
            readiness: SemanticHostReadiness::discover_with_launcher(config, launcher.clone()),
            launcher,
            session: Mutex::new(None),
            document_generations: Arc::new(
                Mutex::new(SemanticDocumentGenerationTracker::default()),
            ),
            supervisor: SemanticHostSupervisor::new(memory_budget_bytes),
        }
    }

    pub fn readiness(&self) -> &SemanticHostReadiness {
        &self.readiness
    }

    pub fn session(&self) -> Result<Arc<SemanticWorkerSession>, String> {
        self.start_session(false)
    }

    pub fn supervisor_snapshot(&self) -> SemanticSupervisorSnapshot {
        self.supervisor.snapshot()
    }

    fn start_session(&self, restart: bool) -> Result<Arc<SemanticWorkerSession>, String> {
        if !self.readiness.is_ready() {
            return Err(self.readiness.detail());
        }

        let mut guard = self
            .session
            .lock()
            .map_err(|_| "Semantic host manager session lock is poisoned".to_string())?;

        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }

        if !restart {
            self.supervisor.ensure_start_allowed()?;
        }
        self.supervisor.mark_starting(restart);

        self.readiness.config.apply_to_process_env();
        let transport = self
            .launcher
            .launch(&self.readiness.config)
            .map_err(|error| {
                self.supervisor.mark_terminal_failure(&error);
                error
            })?;
        let session = Arc::new(SemanticWorkerSession::from_transport_with_generations(
            transport,
            self.document_generations.clone(),
        ));
        session.health().map_err(|error| {
            self.supervisor.mark_terminal_failure(&error);
            error
        })?;
        let restored_document_count = session.restore_tracked_documents().map_err(|error| {
            self.supervisor.mark_terminal_failure(&error);
            error
        })?;
        self.supervisor.mark_restored(restored_document_count);
        if self.supervisor.mark_running(session.runtime_snapshot()) {
            let error = "Semantic worker exceeded its memory budget during startup".to_string();
            self.supervisor.mark_terminal_failure(&error);
            return Err(error);
        }
        *guard = Some(session.clone());

        Ok(session)
    }

    pub fn request<T>(
        &self,
        operation: impl Fn(&SemanticWorkerSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let session = self.session()?;
        match operation(&session) {
            Ok(value) => {
                if self.supervisor.mark_success(session.runtime_snapshot()) {
                    self.invalidate(&session);
                }
                Ok(value)
            }
            Err(first_error) => {
                self.supervisor.mark_transient_failure(&first_error);
                self.invalidate(&session);
                let restarted = self.start_session(true).map_err(|restart_error| {
                    format!(
                        "Semantic worker request failed ({first_error}); restart failed: {restart_error}"
                    )
                })?;
                match operation(&restarted) {
                    Ok(value) => {
                        if self.supervisor.mark_success(restarted.runtime_snapshot()) {
                            self.invalidate(&restarted);
                        }
                        Ok(value)
                    }
                    Err(retry_error) => {
                        self.supervisor.mark_terminal_failure(&retry_error);
                        self.invalidate(&restarted);
                        Err(format!(
                            "Semantic worker request failed ({first_error}); retry failed: {retry_error}"
                        ))
                    }
                }
            }
        }
    }

    fn invalidate(&self, failed: &Arc<SemanticWorkerSession>) {
        let Ok(mut guard) = self.session.lock() else {
            return;
        };
        if guard
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, failed))
        {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use super::{SemanticHostManager, SemanticHostReadiness};
    use crate::models::language::LanguageQueryRequest;
    use crate::services::semantic_host::config::SemanticHostConfig;
    use crate::services::semantic_host::launcher::direct_semantic_worker_launcher;
    use crate::services::semantic_host::sdk::HARMONY_SDK_PATH_ENV;

    fn unique_temp_path(name: &str, extension: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}.{extension}"))
    }

    fn mock_worker_entry() -> PathBuf {
        let path = unique_temp_path("mock-semantic-worker", "mjs");
        fs::write(
            &path,
            r#"
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const payload = request.method === "health" ? { health: { status: "ok", protocolVersion: 3 } } : {};
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, payload, error: null })}\n`);
});
"#,
        )
        .unwrap();
        path
    }

    fn crash_once_worker_entry(marker: &PathBuf) -> PathBuf {
        let path = unique_temp_path("restart-semantic-worker", "mjs");
        let marker_json = serde_json::to_string(&marker.to_string_lossy()).unwrap();
        fs::write(
            &path,
            format!(
                r#"
import fs from "node:fs";
import readline from "node:readline";

const marker = {marker_json};
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }});
rl.on("line", (line) => {{
  const request = JSON.parse(line);
  if (request.method === "health") {{
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ status: "ok", protocolVersion: 3 }}, error: null }})}}\n`);
  }} else if (!fs.existsSync(marker)) {{
    fs.writeFileSync(marker, "crashed");
    process.exit(7);
  }} else {{
    const definition = {{ path: "/workspace/recovered.ets", line: 4, column: 2 }};
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ definition }}, error: null }})}}\n`);
  }}
}});
"#,
            ),
        )
        .unwrap();
        path
    }

    fn always_crashing_worker_entry() -> PathBuf {
        let path = unique_temp_path("always-crashing-semantic-worker", "mjs");
        fs::write(
            &path,
            r#"
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "health") {
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, payload: { status: "ok", protocolVersion: 3 }, error: null })}\n`);
  } else {
    process.exit(9);
  }
});
"#,
        )
        .unwrap();
        path
    }

    fn high_memory_worker_entry() -> PathBuf {
        let path = unique_temp_path("high-memory-semantic-worker", "mjs");
        fs::write(
            &path,
            r#"
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const payload = { status: "ok", protocolVersion: 3 };
  const runtime = { rssBytes: 101, heapUsedBytes: 50, heapTotalBytes: 80, externalBytes: 1, uptimeMs: 5 };
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, payload, runtime, error: null })}\n`);
});
"#,
        )
        .unwrap();
        path
    }

    #[test]
    fn host_is_not_ready_without_sdk_and_worker() {
        let readiness = SemanticHostReadiness::discover(SemanticHostConfig::default());

        if readiness.is_ready() {
            assert!(readiness.detail().contains("Semantic worker is ready"));
        } else {
            assert!(!readiness.detail().is_empty());
        }
    }

    #[test]
    fn reuses_the_same_worker_session_while_it_is_healthy() {
        let temp_sdk_root = std::env::temp_dir().join(format!(
            "arkline-sdk-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(temp_sdk_root.join("ets")).unwrap();
        fs::create_dir_all(temp_sdk_root.join("toolchains")).unwrap();
        let worker_entry = mock_worker_entry();
        let previous = std::env::var(HARMONY_SDK_PATH_ENV).ok();
        std::env::set_var(
            HARMONY_SDK_PATH_ENV,
            temp_sdk_root.to_string_lossy().to_string(),
        );

        let manager = SemanticHostManager::discover(SemanticHostConfig {
            harmony_sdk_path: Some(temp_sdk_root.to_string_lossy().to_string()),
            harmony_sdk_auto_detect: false,
            semantic_worker_path: Some(worker_entry.to_string_lossy().to_string()),
            node_path: None,
        });
        let first = manager.session().expect("first session should start");
        let second = manager.session().expect("second session should reuse");

        assert!(std::sync::Arc::ptr_eq(&first, &second));

        drop(first);
        drop(second);
        if let Some(value) = previous {
            std::env::set_var(HARMONY_SDK_PATH_ENV, value);
        } else {
            std::env::remove_var(HARMONY_SDK_PATH_ENV);
        }
        fs::remove_dir_all(temp_sdk_root).unwrap();
        fs::remove_file(worker_entry).unwrap();
    }

    #[test]
    fn restarts_once_and_retries_read_only_request_after_worker_crash() {
        let marker = unique_temp_path("semantic-worker-crashed", "txt");
        let worker_entry = crash_once_worker_entry(&marker);
        let manager = SemanticHostManager::discover(SemanticHostConfig {
            semantic_worker_path: Some(worker_entry.to_string_lossy().to_string()),
            ..SemanticHostConfig::default()
        });
        let first_pid = manager.session().unwrap().process_id().unwrap();
        let request = LanguageQueryRequest {
            path: "/workspace/main.ets".to_string(),
            line: 1,
            column: 1,
            content: None,
        };

        let target = manager
            .request(|session| session.goto_definition(&request))
            .expect("request should recover")
            .expect("definition should be returned");
        let restarted_pid = manager.session().unwrap().process_id().unwrap();

        assert_eq!(target.path, "/workspace/recovered.ets");
        assert_ne!(first_pid, restarted_pid);
        fs::remove_file(marker).unwrap();
        fs::remove_file(worker_entry).unwrap();
    }

    #[test]
    fn repeated_worker_crashes_enter_backoff_without_blocking_caller() {
        let worker_entry = always_crashing_worker_entry();
        let manager = SemanticHostManager::discover(SemanticHostConfig {
            semantic_worker_path: Some(worker_entry.to_string_lossy().to_string()),
            ..SemanticHostConfig::default()
        });
        let request = LanguageQueryRequest {
            path: "/workspace/main.ets".to_string(),
            line: 1,
            column: 1,
            content: None,
        };

        assert!(manager
            .request(|session| session.goto_definition(&request))
            .is_err());
        let snapshot = manager.supervisor_snapshot();
        assert_eq!(snapshot.status, "backoff");
        assert_eq!(snapshot.restart_count, 1);
        assert_eq!(snapshot.consecutive_failures, 2);

        let started = Instant::now();
        assert!(manager
            .request(|session| session.goto_definition(&request))
            .is_err());
        assert!(started.elapsed() < Duration::from_millis(100));
        assert_eq!(manager.supervisor_snapshot().restart_count, 1);
        fs::remove_file(worker_entry).unwrap();
    }

    #[test]
    fn worker_over_memory_budget_is_recycled_before_becoming_active() {
        let worker_entry = high_memory_worker_entry();
        let manager = SemanticHostManager::discover_with_launcher_and_budget(
            SemanticHostConfig {
                semantic_worker_path: Some(worker_entry.to_string_lossy().to_string()),
                ..SemanticHostConfig::default()
            },
            direct_semantic_worker_launcher(),
            100,
        );

        let error = manager.session().err().expect("startup should be rejected");
        let snapshot = manager.supervisor_snapshot();

        assert!(error.contains("memory budget"));
        assert_eq!(snapshot.status, "backoff");
        assert_eq!(snapshot.runtime.unwrap().rss_bytes, 101);
        fs::remove_file(worker_entry).unwrap();
    }
}
