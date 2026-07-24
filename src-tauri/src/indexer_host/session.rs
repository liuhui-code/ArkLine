use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use crate::indexer_sidecar::{
    IndexerContentRefreshRequest, IndexerContentRefreshResult, IndexerDiscoveryRequest,
    IndexerDiscoveryResult, IndexerRequest, IndexerResponse, IndexerStubRefreshRequest,
    IndexerStubRefreshResult, IndexerTaskKey, INDEXER_PROTOCOL_VERSION,
};
use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;
use crate::services::process_command_service::hidden_command;

const INDEXER_HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const INDEXER_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const INDEXER_CONTENT_REFRESH_TIMEOUT: Duration = Duration::from_secs(30);
const INDEXER_STUB_REFRESH_TIMEOUT: Duration = Duration::from_secs(30);
const INDEXER_CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(25);
const INDEXER_REQUEST_CANCELLED: &str = "Indexer request cancelled";

pub struct IndexerHostSession {
    child: Child,
    stdin: ChildStdin,
    response_rx: Receiver<Result<String, String>>,
    next_request_id: u64,
    capabilities: Vec<String>,
    writer_metrics: Option<WorkspaceIndexWriterMetrics>,
    publication_profile: Option<WorkspaceIndexPublicationProfile>,
}

impl IndexerHostSession {
    pub fn start(executable_path: &Path) -> Result<Self, String> {
        let mut command = hidden_command(executable_path);
        configure_worker_process(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to launch indexer {}: {error}",
                    executable_path.display()
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Indexer stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Indexer stdout is unavailable".to_string())?;
        if let Some(stderr) = child.stderr.take() {
            drain_stderr(stderr);
        }
        Ok(Self {
            child,
            stdin,
            response_rx: spawn_stdout_reader(stdout),
            next_request_id: 1,
            capabilities: Vec::new(),
            writer_metrics: None,
            publication_profile: None,
        })
    }

    pub fn health(&mut self) -> Result<Vec<String>, String> {
        let response = self.exchange("health", None, INDEXER_HEALTH_TIMEOUT)?;
        let capabilities = validate_health_response(response)?;
        self.capabilities = capabilities.clone();
        Ok(capabilities)
    }

    pub fn discover_workspace_chunk(
        &mut self,
        task: IndexerTaskKey,
        pending_directories: Option<Vec<String>>,
        limit: usize,
    ) -> Result<IndexerDiscoveryResult, String> {
        self.exchange_discovery_chunk("discoverWorkspaceChunk", task, pending_directories, limit)
    }

    pub(super) fn prepare_discovery_chunk(
        &mut self,
        task: IndexerTaskKey,
        pending_directories: Option<Vec<String>>,
        limit: usize,
    ) -> Result<IndexerDiscoveryResult, String> {
        self.exchange_discovery_chunk("prepareDiscoveryChunk", task, pending_directories, limit)
    }

    fn exchange_discovery_chunk(
        &mut self,
        method: &str,
        task: IndexerTaskKey,
        pending_directories: Option<Vec<String>>,
        limit: usize,
    ) -> Result<IndexerDiscoveryResult, String> {
        let expected_task = task.clone();
        let payload = serde_json::to_value(IndexerDiscoveryRequest {
            task,
            pending_directories,
            limit,
        })
        .map_err(|error| format!("Failed to serialize discovery payload: {error}"))?;
        let response = self.exchange(method, Some(payload), INDEXER_DISCOVERY_TIMEOUT)?;
        let result: IndexerDiscoveryResult = serde_json::from_value(response.payload)
            .map_err(|error| format!("Invalid indexer discovery response: {error}"))?;
        self.record_publication_profile(&result.publication_profile);
        if result.task != expected_task {
            return Err("Indexer discovery returned a mismatched task key".to_string());
        }
        Ok(result)
    }

    pub fn refresh_stub_chunk<F>(
        &mut self,
        task: IndexerTaskKey,
        indexed_generation: u64,
        changed_paths: Vec<String>,
        removed_paths: Vec<String>,
        is_cancelled: F,
    ) -> Result<IndexerStubRefreshResult, String>
    where
        F: FnMut() -> bool,
    {
        let expected_task = task.clone();
        let payload = serde_json::to_value(IndexerStubRefreshRequest {
            task,
            indexed_generation,
            changed_paths,
            removed_paths,
            priority: "background".to_string(),
        })
        .map_err(|error| format!("Failed to serialize stub refresh payload: {error}"))?;
        let method = if self.supports_writer_actor_publication() {
            "prepareStubChunk"
        } else {
            "refreshStubChunk"
        };
        let response = self.exchange_cancellable(
            method,
            Some(payload),
            INDEXER_STUB_REFRESH_TIMEOUT,
            is_cancelled,
        )?;
        let result: IndexerStubRefreshResult = serde_json::from_value(response.payload)
            .map_err(|error| format!("Invalid indexer stub refresh response: {error}"))?;
        self.record_publication_profile(&result.publication_profile);
        if result.task != expected_task {
            return Err("Indexer stub refresh returned a mismatched task key".to_string());
        }
        Ok(result)
    }

    pub fn refresh_content_chunk<F>(
        &mut self,
        task: IndexerTaskKey,
        indexed_generation: u64,
        changed_paths: Vec<String>,
        removed_paths: Vec<String>,
        is_cancelled: F,
    ) -> Result<IndexerContentRefreshResult, String>
    where
        F: FnMut() -> bool,
    {
        let expected_task = task.clone();
        let payload = serde_json::to_value(IndexerContentRefreshRequest {
            task,
            indexed_generation,
            changed_paths,
            removed_paths,
            priority: "background".to_string(),
        })
        .map_err(|error| format!("Failed to serialize content refresh payload: {error}"))?;
        let method = if self.supports_writer_actor_publication() {
            "prepareContentChunk"
        } else {
            "refreshContentChunk"
        };
        let response = self.exchange_cancellable(
            method,
            Some(payload),
            INDEXER_CONTENT_REFRESH_TIMEOUT,
            is_cancelled,
        )?;
        let result: IndexerContentRefreshResult = serde_json::from_value(response.payload)
            .map_err(|error| format!("Invalid indexer content refresh response: {error}"))?;
        self.record_publication_profile(&result.publication_profile);
        if result.task != expected_task {
            return Err("Indexer content refresh returned a mismatched task key".to_string());
        }
        Ok(result)
    }

    pub fn process_id(&self) -> u32 {
        self.child.id()
    }

    pub fn writer_metrics(&self) -> Option<&WorkspaceIndexWriterMetrics> {
        self.writer_metrics.as_ref()
    }

    pub fn publication_profile(&self) -> Option<&WorkspaceIndexPublicationProfile> {
        self.publication_profile.as_ref()
    }

    pub(super) fn supports_writer_actor_publication(&self) -> bool {
        self.capabilities
            .iter()
            .any(|capability| capability == "writerActorPublication")
    }

    pub(super) fn supports_discovery_writer_actor_publication(&self) -> bool {
        self.supports_writer_actor_publication()
            && self
                .capabilities
                .iter()
                .any(|capability| capability == "discoveryPrepareChunk")
    }

    pub(super) fn record_publication_profile(
        &mut self,
        profile: &WorkspaceIndexPublicationProfile,
    ) {
        if profile.total_duration_us > 0 || !profile.stages.is_empty() {
            self.publication_profile = Some(profile.clone());
        }
    }

    fn exchange(
        &mut self,
        method: &str,
        payload: Option<serde_json::Value>,
        timeout: Duration,
    ) -> Result<IndexerResponse, String> {
        self.exchange_cancellable(method, payload, timeout, || false)
    }

    fn exchange_cancellable<F>(
        &mut self,
        method: &str,
        payload: Option<serde_json::Value>,
        timeout: Duration,
        mut is_cancelled: F,
    ) -> Result<IndexerResponse, String>
    where
        F: FnMut() -> bool,
    {
        if is_cancelled() {
            return Err(INDEXER_REQUEST_CANCELLED.to_string());
        }
        let id = format!("indexer-{}-{}", method, self.next_request_id);
        self.next_request_id = self.next_request_id.saturating_add(1);
        let request = IndexerRequest {
            id: id.clone(),
            method: method.to_string(),
            payload,
        };
        let serialized = serde_json::to_string(&request)
            .map_err(|error| format!("Failed to serialize indexer request: {error}"))?;
        self.stdin
            .write_all(serialized.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Failed to write indexer request: {error}"))?;
        let line = wait_for_response(
            &self.response_rx,
            timeout,
            INDEXER_CANCEL_POLL_INTERVAL,
            &mut is_cancelled,
        )?;
        let response: IndexerResponse = serde_json::from_str(line.trim())
            .map_err(|error| format!("Invalid indexer response: {error}"))?;
        if response.id != id {
            let detail = response
                .error
                .as_deref()
                .map(|error| format!(": {error}"))
                .unwrap_or_default();
            return Err(format!(
                "Indexer response id mismatch: expected {id}, received {}{detail}",
                response.id,
            ));
        }
        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "Indexer request failed".to_string()));
        }
        if let Some(telemetry) = &response.telemetry {
            self.writer_metrics = Some(telemetry.writer_metrics.clone());
        }
        Ok(response)
    }
}

pub(super) fn is_cancelled_error(error: &str) -> bool {
    error == INDEXER_REQUEST_CANCELLED
}

pub(super) fn is_stale_generation_error(error: &str) -> bool {
    error.starts_with("Stale ") && error.contains(" generation ")
}

fn wait_for_response<F>(
    response_rx: &Receiver<Result<String, String>>,
    timeout: Duration,
    poll_interval: Duration,
    is_cancelled: &mut F,
) -> Result<String, String>
where
    F: FnMut() -> bool,
{
    let deadline = Instant::now() + timeout;
    loop {
        if is_cancelled() {
            return Err(INDEXER_REQUEST_CANCELLED.to_string());
        }
        let now = Instant::now();
        if now >= deadline {
            return Err("Timed out waiting for indexer response".to_string());
        }
        let wait = poll_interval.min(deadline.saturating_duration_since(now));
        match response_rx.recv_timeout(wait) {
            Ok(line) => return line,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err("Indexer response channel disconnected".to_string());
            }
        }
    }
}

impl Drop for IndexerHostSession {
    fn drop(&mut self) {
        terminate_worker_process(&mut self.child);
    }
}

#[cfg(unix)]
fn configure_worker_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_worker_process(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_worker_process(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    // SAFETY: start() makes the child the leader of a dedicated process group.
    // A negative process ID therefore targets only this sidecar and descendants.
    unsafe {
        libc::killpg(child.id() as i32, libc::SIGKILL);
    }
    let _ = child.wait();
}

#[cfg(not(unix))]
fn terminate_worker_process(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn validate_health_response(response: IndexerResponse) -> Result<Vec<String>, String> {
    let version = response.payload["protocolVersion"]
        .as_u64()
        .ok_or_else(|| "Indexer health omitted protocolVersion".to_string())?;
    if version != INDEXER_PROTOCOL_VERSION {
        return Err(format!(
            "Indexer protocol mismatch: host {INDEXER_PROTOCOL_VERSION}, sidecar {version}"
        ));
    }
    response.payload["capabilities"]
        .as_array()
        .ok_or_else(|| "Indexer health omitted capabilities".to_string())?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "Indexer capability was not a string".to_string())
        })
        .collect()
}

fn spawn_stdout_reader(stdout: ChildStdout) -> Receiver<Result<String, String>> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender
                .send(line.map_err(|error| error.to_string()))
                .is_err()
            {
                break;
            }
        }
    });
    receiver
}

fn drain_stderr(stderr: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut stderr = BufReader::new(stderr);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
}

#[cfg(test)]
mod tests {
    use super::validate_health_response;
    use crate::indexer_sidecar::{IndexerResponse, INDEXER_PROTOCOL_VERSION};

    #[test]
    fn rejects_a_mismatched_protocol_before_task_execution() {
        let response = IndexerResponse {
            id: "health-1".to_string(),
            ok: true,
            payload: serde_json::json!({
                "status": "ready",
                "protocolVersion": INDEXER_PROTOCOL_VERSION + 1,
                "capabilities": ["health"],
            }),
            telemetry: None,
            error: None,
        };

        assert!(validate_health_response(response)
            .unwrap_err()
            .contains("protocol mismatch"));
    }
}
