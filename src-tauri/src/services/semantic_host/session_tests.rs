use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::language::LanguageQueryRequest;
use crate::services::process_command_service::hidden_command;
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::process::SemanticWorkerProcessSpec;
use crate::services::semantic_host::session::{
    parse_completion_item, IdleHealthProbe, SemanticWorkerSession,
};

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
  const runtime = { rssBytes: 104857600, heapUsedBytes: 40, heapTotalBytes: 80, externalBytes: 2, uptimeMs: 10 };
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, payload, runtime, error: null })}\n`);
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

fn incompatible_worker_entry() -> PathBuf {
    let path = unique_temp_path("incompatible-semantic-worker", "mjs");
    fs::write(
        &path,
        r#"
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    ok: true,
    payload: { status: "ready", protocolVersion: 1 },
    error: null,
  })}\n`);
});
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

fn stale_generation_worker_entry() -> PathBuf {
    let path = unique_temp_path("stale-generation-semantic-worker", "mjs");
    fs::write(
        &path,
        r#"
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const generation = request.position?.contentGeneration ?? 0;
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    ok: true,
    payload: [],
    state: { contentGeneration: generation + 1 },
  })}\n`);
});
"#,
    )
    .unwrap();
    path
}

fn slow_query_worker_entry(marker: &PathBuf) -> PathBuf {
    let path = unique_temp_path("slow-query-semantic-worker", "mjs");
    let marker = serde_json::to_string(&marker.to_string_lossy()).unwrap();
    fs::write(
        &path,
        format!(
            r#"
import fs from "node:fs";
import readline from "node:readline";

const marker = {marker};
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }});
rl.on("line", (line) => {{
  const request = JSON.parse(line);
  if (request.method === "health") {{
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ status: "ready", protocolVersion: 3 }} }})}}\n`);
    return;
  }}
  fs.writeFileSync(marker, "query-started");
  setTimeout(() => {{
    const state = {{ contentGeneration: request.position.contentGeneration }};
    process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: [], state }})}}\n`);
  }}, 200);
}});
"#,
        ),
    )
    .unwrap();
    path
}

#[cfg(unix)]
fn assert_process_exited(pid: u32) {
    let output = match hidden_command("ps").args(["-p", &pid.to_string()]).output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
        Err(error) => panic!("ps should run: {error}"),
    };

    assert!(!output.status.success());
}

#[cfg(windows)]
fn assert_process_exited(pid: u32) {
    let output = hidden_command("tasklist")
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

    let parsed: Vec<_> = items.iter().filter_map(parse_completion_item).collect();

    assert_eq!(parsed[0].kind, "keyword");
    assert_eq!(parsed[1].kind, "function");
}

#[test]
fn parses_completion_v2_fields() {
    let item = serde_json::json!({
        "label": "width",
        "detail": "width(value: Length): T",
        "kind": "method",
        "insertText": "width(${1:value})",
        "filterText": "width",
        "sortText": "0100-width",
        "source": "arkui",
        "documentation": "Sets the width of the component.",
        "replacementRange": {
            "startLine": 8,
            "startColumn": 6,
            "endLine": 8,
            "endColumn": 8
        },
        "commitCharacters": ["(", "."],
        "definitionTarget": {
            "path": "/sdk/ets/component/common.d.ts",
            "line": 20927,
            "column": 5
        },
        "data": { "provider": "arkui-sdk" }
    });

    let parsed = parse_completion_item(&item).expect("completion item should parse");

    assert_eq!(parsed.label, "width");
    assert_eq!(parsed.insert_text.as_deref(), Some("width(${1:value})"));
    assert_eq!(parsed.filter_text.as_deref(), Some("width"));
    assert_eq!(parsed.sort_text.as_deref(), Some("0100-width"));
    assert_eq!(parsed.source.as_deref(), Some("arkui"));
    assert_eq!(
        parsed.documentation.as_deref(),
        Some("Sets the width of the component.")
    );
    assert_eq!(parsed.commit_characters, vec!["(", "."]);
    assert_eq!(parsed.replacement_range.unwrap().start_column, 6);
    assert_eq!(parsed.definition_target.unwrap().line, 20927);
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
    assert_eq!(
        session.runtime_snapshot().unwrap().rss_bytes,
        100 * 1024 * 1024
    );

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
fn rejects_an_incompatible_worker_protocol() {
    let entry_path = incompatible_worker_entry();
    let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
        semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
        ..SemanticHostConfig::default()
    })
    .expect("worker spec should be discoverable");
    let session = SemanticWorkerSession::start(&spec).expect("worker session should start");

    let error = session.health().unwrap_err();

    assert!(error.contains("protocol mismatch"));
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

#[test]
fn rejects_a_semantic_response_for_the_wrong_document_generation() {
    let entry_path = stale_generation_worker_entry();
    let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
        semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
        ..SemanticHostConfig::default()
    })
    .expect("worker spec should be discoverable");
    let session = SemanticWorkerSession::start(&spec).expect("worker session should start");
    let error = session
        .completion(&LanguageQueryRequest {
            path: "/tmp/Index.ets".to_string(),
            line: 1,
            column: 1,
            content: Some("const value = 1".to_string()),
        })
        .unwrap_err();

    assert!(error.contains("served stale document generation"));
    fs::remove_file(entry_path).unwrap();
}

#[test]
fn idle_health_probe_skips_a_busy_foreground_transport() {
    let marker = unique_temp_path("slow-query-started", "txt");
    let entry_path = slow_query_worker_entry(&marker);
    let spec = SemanticWorkerProcessSpec::discover_with_config(&SemanticHostConfig {
        semantic_worker_path: Some(entry_path.to_string_lossy().to_string()),
        ..SemanticHostConfig::default()
    })
    .expect("worker spec should be discoverable");
    let session =
        Arc::new(SemanticWorkerSession::start(&spec).expect("worker session should start"));
    session.health().unwrap();
    let foreground = {
        let session = session.clone();
        thread::spawn(move || {
            session.completion(&LanguageQueryRequest {
                path: "/tmp/Busy.ets".to_string(),
                line: 1,
                column: 1,
                content: Some("const busy = true".to_string()),
            })
        })
    };
    for _ in 0..100 {
        if marker.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(2));
    }

    assert!(marker.exists());
    assert!(matches!(session.try_health(), IdleHealthProbe::Busy));
    foreground.join().unwrap().unwrap();

    fs::remove_file(marker).unwrap();
    fs::remove_file(entry_path).unwrap();
}
