use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::process_command_service::hidden_command;
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::process::SemanticWorkerProcessSpec;
use crate::services::semantic_host::session::{parse_completion_item, SemanticWorkerSession};

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
