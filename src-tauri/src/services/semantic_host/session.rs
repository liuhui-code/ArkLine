use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, LanguageQueryRequest,
};

use super::process::SemanticWorkerProcessSpec;
use super::protocol::{SemanticDocumentPosition, SemanticRequest};

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
    stdout: Mutex<BufReader<ChildStdout>>,
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

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            stdout: Mutex::new(BufReader::new(stdout)),
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

        let mut line = String::new();
        {
            let mut stdout = self
                .stdout
                .lock()
                .map_err(|_| "Semantic worker stdout lock is poisoned".to_string())?;
            stdout.read_line(&mut line).map_err(|error| {
                format!("Failed to read semantic worker response {request_id}: {error}")
            })?;
        }

        if line.trim().is_empty() {
            let stderr_detail = self.read_stderr_snippet();
            return Err(format!(
                "Semantic worker returned an empty response for {request_id}{}",
                stderr_detail
                    .map(|value| format!(" ({value})"))
                    .unwrap_or_default()
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

    fn read_stderr_snippet(&self) -> Option<String> {
        let mut child = self.child.lock().ok()?;
        let stderr = child.stderr.as_mut()?;
        let mut buffer = [0_u8; 256];
        let bytes_read = std::io::Read::read(stderr, &mut buffer).ok()?;
        if bytes_read == 0 {
            return None;
        }

        Some(
            String::from_utf8_lossy(&buffer[..bytes_read])
                .trim()
                .to_string(),
        )
    }
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

    #[cfg(unix)]
    fn assert_process_exited(pid: u32) {
        let output = Command::new("ps")
            .args(["-p", &pid.to_string()])
            .output()
            .expect("ps should run");

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
}
