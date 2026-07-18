use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::config::SemanticHostConfig;
use super::manager::SemanticHostManager;
use crate::models::language::LanguageQueryRequest;

#[test]
fn replays_hot_documents_before_retrying_after_a_worker_crash() {
    let crash_marker = unique_temp_path("semantic-replay-crash", "txt");
    let replay_marker = unique_temp_path("semantic-replay-documents", "json");
    let worker_entry = replay_aware_crash_worker(&crash_marker, &replay_marker);
    let manager = SemanticHostManager::discover(SemanticHostConfig {
        semantic_worker_path: Some(worker_entry.to_string_lossy().to_string()),
        ..SemanticHostConfig::default()
    });
    let request = LanguageQueryRequest {
        path: "/workspace/Unsaved.ets".to_string(),
        line: 2,
        column: 3,
        content: Some("class Unsaved { value = 1 }".to_string()),
    };

    let target = manager
        .request(|session| session.goto_definition(&request))
        .expect("request should recover after replay")
        .expect("definition should be returned");
    let replay: Value = serde_json::from_str(
        &fs::read_to_string(&replay_marker).expect("replay evidence should be recorded"),
    )
    .unwrap();

    assert_eq!(target.path, "/workspace/replayed.ets");
    assert_eq!(replay[0]["path"], "/workspace/Unsaved.ets");
    assert_eq!(replay[0]["contentGeneration"], 1);
    assert_eq!(replay[0]["content"], "class Unsaved { value = 1 }");
    assert_eq!(manager.supervisor_snapshot().restored_document_count, 1);

    for path in [crash_marker, replay_marker, worker_entry] {
        fs::remove_file(path).unwrap();
    }
}

fn replay_aware_crash_worker(crash_marker: &Path, replay_marker: &Path) -> PathBuf {
    let path = unique_temp_path("semantic-replay-worker", "mjs");
    let crash_json = serde_json::to_string(&crash_marker.to_string_lossy()).unwrap();
    let replay_json = serde_json::to_string(&replay_marker.to_string_lossy()).unwrap();
    fs::write(
        &path,
        format!(
            r#"
import fs from "node:fs";
import readline from "node:readline";

const crashMarker = {crash_json};
const replayMarker = {replay_json};
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }});
rl.on("line", (line) => {{
  const request = JSON.parse(line);
  if (request.method === "health") {{
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ status: "ready", protocolVersion: 3 }}, error: null }})}}\n`);
  }} else if (request.method === "restoreDocuments") {{
    fs.writeFileSync(replayMarker, JSON.stringify(request.documents));
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ restoredDocumentCount: request.documents.length }}, error: null }})}}\n`);
  }} else if (!fs.existsSync(crashMarker)) {{
    fs.writeFileSync(crashMarker, "crashed");
    process.exit(7);
  }} else if (fs.existsSync(replayMarker)) {{
    const definition = {{ path: "/workspace/replayed.ets", line: 1, column: 1 }};
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ definition }}, state: {{ contentGeneration: request.position.contentGeneration }}, error: null }})}}\n`);
  }} else {{
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: false, payload: null, error: "documents were not replayed" }})}}\n`);
  }}
}});
"#,
        ),
    )
    .unwrap();
    path
}

fn unique_temp_path(name: &str, extension: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}.{extension}"))
}
