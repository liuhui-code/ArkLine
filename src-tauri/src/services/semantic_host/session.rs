use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, LanguageQueryRequest,
};

use super::process::SemanticWorkerProcessSpec;
use super::protocol::{SemanticDocumentPosition, SemanticRequest};

#[cfg(not(test))]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(test)]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Deserialize)]
struct RawSemanticResponse {
    id: String,
    ok: bool,
    payload: Value,
    error: Option<String>,
}

pub struct SemanticWorkerSession {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    response_rx: Mutex<Receiver<Result<String, String>>>,
    next_request_id: AtomicU64,
}

impl SemanticWorkerSession {
    pub fn start(spec: &SemanticWorkerProcessSpec) -> Result<Self, String> {
        let mut child = Command::new(&spec.node_path)
            .arg(&spec.entry_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to launch semantic worker with node {} and entry {}: {error}",
                    spec.node_path.display(),
                    spec.entry_path.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Semantic worker stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Semantic worker stdout is unavailable".to_string())?;
        let response_rx = spawn_stdout_reader(stdout);

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            response_rx: Mutex::new(response_rx),
            next_request_id: AtomicU64::new(1),
        })
    }

    pub fn health(&self) -> Result<String, String> {
        let response = self.send_request("health", None)?;
        let payload = extract_payload(&response.payload, "health");

        payload
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Semantic worker health response did not include a status".to_string())
    }

    pub fn goto_definition(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Option<DefinitionTarget>, String> {
        let response = self.send_request("gotoDefinition", Some(request))?;
        let payload = extract_payload(&response.payload, "definition");

        if payload.is_null() {
            return Ok(None);
        }

        if let Some(definition) = payload.get("definition") {
            if definition.is_null() {
                return Ok(None);
            }

            return parse_definition_target(definition).map(Some);
        }

        parse_definition_target(payload).map(Some)
    }

    pub fn goto_definition_candidates(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<DefinitionCandidate>, String> {
        let response = self.send_request("gotoDefinition", Some(request))?;
        let payload = extract_payload(&response.payload, "definition");

        if payload.is_null() {
            return Ok(Vec::new());
        }

        if let Some(candidates) = payload.get("definitionCandidates") {
            let items = candidates.as_array().ok_or_else(|| {
                "Semantic worker definitionCandidates response was not an array".to_string()
            })?;

            return items
                .iter()
                .map(parse_definition_candidate)
                .collect::<Result<Vec<_>, _>>();
        }

        parse_definition_candidate(payload).map(|candidate| vec![candidate])
    }

    pub fn completion(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<CompletionItem>, String> {
        let response = self.send_request("completion", Some(request))?;
        let payload = extract_payload(&response.payload, "completion");
        let items = payload
            .as_array()
            .ok_or_else(|| "Semantic worker completion response was not an array".to_string())?;

        Ok(items
            .iter()
            .filter_map(|item| {
                Some(CompletionItem {
                    label: item.get("label")?.as_str()?.to_string(),
                    detail: item.get("detail")?.as_str()?.to_string(),
                    kind: item.get("kind")?.as_str()?.to_string(),
                })
            })
            .collect())
    }

    #[cfg(test)]
    pub fn process_id(&self) -> Option<u32> {
        self.child.lock().ok().map(|child| child.id())
    }

    fn send_request(
        &self,
        method: &str,
        request: Option<&LanguageQueryRequest>,
    ) -> Result<RawSemanticResponse, String> {
        let request_id = format!(
            "semantic-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let payload = SemanticRequest {
            id: request_id.clone(),
            method: method.to_string(),
            position: request.map(|value| SemanticDocumentPosition {
                path: value.path.clone(),
                line: value.line,
                column: value.column,
            }),
        };
        let serialized = serde_json::to_string(&payload).map_err(|error| {
            format!("Failed to serialize semantic worker request {request_id}: {error}")
        })?;

        {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| "Semantic worker stdin lock is poisoned".to_string())?;
            stdin
                .write_all(serialized.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|error| {
                    format!("Failed to write semantic worker request {request_id}: {error}")
                })?;
        }

        let line = self.read_response_line(&request_id)?;

        if line.trim().is_empty() {
            return Err(format!(
                "Semantic worker returned an empty response for {request_id}"
            ));
        }

        let response: RawSemanticResponse = serde_json::from_str(line.trim()).map_err(|error| {
            format!("Failed to parse semantic worker response {request_id}: {error}")
        })?;

        if response.id != request_id {
            return Err(format!(
                "Semantic worker response id mismatch: expected {request_id}, received {}",
                response.id
            ));
        }

        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "Semantic worker request failed".to_string()));
        }

        Ok(response)
    }

    fn read_response_line(&self, request_id: &str) -> Result<String, String> {
        let response_rx = self
            .response_rx
            .lock()
            .map_err(|_| "Semantic worker response lock is poisoned".to_string())?;

        match response_rx.recv_timeout(SEMANTIC_WORKER_REQUEST_TIMEOUT) {
            Ok(Ok(line)) => Ok(line),
            Ok(Err(error)) => Err(format!(
                "Failed to read semantic worker response {request_id}: {error}"
            )),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.kill_worker();
                Err(format!(
                    "Timed out waiting for semantic worker response {request_id}"
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!(
                "Semantic worker response channel closed for {request_id}"
            )),
        }
    }

    fn kill_worker(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_stdout_reader(stdout: ChildStdout) -> Receiver<Result<String, String>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stdout = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match stdout.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(error.to_string()));
                    break;
                }
            }
        }
    });
    rx
}

fn parse_definition_target(payload: &Value) -> Result<DefinitionTarget, String> {
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Semantic worker definition response did not include a path".to_string())?;
    let line = payload
        .get("line")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Semantic worker definition response did not include a line".to_string())?;
    let column = payload
        .get("column")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            "Semantic worker definition response did not include a column".to_string()
        })?;

    Ok(DefinitionTarget {
        path: path.to_string(),
        line: line as u32,
        column: column as u32,
    })
}

fn parse_definition_candidate(payload: &Value) -> Result<DefinitionCandidate, String> {
    let target = parse_definition_target(payload)?;

    Ok(DefinitionCandidate {
        path: target.path,
        line: target.line,
        column: target.column,
        preview: String::new(),
    })
}

impl Drop for SemanticWorkerSession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            for _ in 0..10 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                    Err(_) => break,
                }
            }
        }
    }
}

fn extract_payload<'a>(payload: &'a Value, key: &str) -> &'a Value {
    payload.get(key).unwrap_or(payload)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    #[cfg(any(unix, windows))]
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::SemanticWorkerSession;
    use crate::services::semantic_host::config::SemanticHostConfig;
    use crate::services::semantic_host::process::SemanticWorkerProcessSpec;

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
  const payload = request.method === "health" ? { health: { status: "ok" } } : {};
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, payload, error: null })}\n`);
});
"#,
        )
        .unwrap();
        path
    }

    fn hanging_worker_entry() -> PathBuf {
        let path = unique_temp_path("hanging-semantic-worker", "mjs");
        fs::write(
            &path,
            r#"
import readline from "node:readline";

readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
setInterval(() => {}, 1000);
"#,
        )
        .unwrap();
        path
    }

    fn empty_line_worker_entry() -> PathBuf {
        let path = unique_temp_path("empty-line-semantic-worker", "mjs");
        fs::write(
            &path,
            r#"
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", () => {
  process.stdout.write("\n");
});
setInterval(() => {}, 1000);
"#,
        )
        .unwrap();
        path
    }

    #[cfg(unix)]
    fn assert_process_exited(pid: u32) {
        let output = match Command::new("ps").args(["-p", &pid.to_string()]).output() {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(error) => panic!("ps should run: {error}"),
        };

        assert!(!output.status.success());
    }

    #[cfg(windows)]
    fn assert_process_exited(pid: u32) {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .expect("tasklist should run");
        let stdout = String::from_utf8_lossy(&output.stdout);

        assert!(!stdout.contains(&pid.to_string()));
    }

    #[test]
    fn classifies_completion_items() {
        let items = vec![
            serde_json::json!({"label":"@Entry","detail":"ArkTS decorator","kind":"keyword"}),
            serde_json::json!({"label":"submit()","detail":"Semantic workspace function","kind":"function"}),
        ];

        let parsed: Vec<_> = items
            .iter()
            .filter_map(|item| {
                Some(crate::models::language::CompletionItem {
                    label: item.get("label")?.as_str()?.to_string(),
                    detail: item.get("detail")?.as_str()?.to_string(),
                    kind: item.get("kind")?.as_str()?.to_string(),
                })
            })
            .collect();

        assert_eq!(parsed[0].kind, "keyword");
        assert_eq!(parsed[1].kind, "function");
    }

    #[test]
    fn drops_and_stops_the_worker_process() {
        let entry_path = mock_worker_entry();
        let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
            semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
            ..SemanticHostConfig::default()
        })
        .expect("worker spec should be discoverable");
        let session = SemanticWorkerSession::start(&spec).expect("worker session should start");
        let pid = session
            .process_id()
            .expect("worker pid should be available");

        assert_eq!(session.health().unwrap(), "ok");

        drop(session);

        assert_process_exited(pid);
        fs::remove_file(entry_path).unwrap();
    }

    #[test]
    fn times_out_when_worker_starts_but_never_responds() {
        let entry_path = hanging_worker_entry();
        let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
            semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
            ..SemanticHostConfig::default()
        })
        .expect("worker spec should be discoverable");
        let session = SemanticWorkerSession::start(&spec).expect("worker session should start");

        let error = session.health().unwrap_err();

        assert!(error.contains("Timed out waiting for semantic worker response"));
        fs::remove_file(entry_path).unwrap();
    }

    #[test]
    fn rejects_empty_worker_response_without_blocking_on_stderr() {
        let entry_path = empty_line_worker_entry();
        let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
            semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
            ..SemanticHostConfig::default()
        })
        .expect("worker spec should be discoverable");
        let session = SemanticWorkerSession::start(&spec).expect("worker session should start");

        let error = session.health().unwrap_err();

        assert!(error.contains("Semantic worker returned an empty response"));
        fs::remove_file(entry_path).unwrap();
    }
}
