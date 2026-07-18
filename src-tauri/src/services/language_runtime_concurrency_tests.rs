use std::fs;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::models::language::LanguageQueryRequest;
use crate::services::language_service::{complete_symbol, hover_symbol, LanguageRuntime};
use crate::services::settings_store::default_settings;

fn unique_temp_path(name: &str, extension: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}.{extension}"))
}

#[test]
fn slow_semantic_request_does_not_hold_language_router_state_lock() {
    let worker = unique_temp_path("slow-semantic-worker", "mjs");
    let marker = unique_temp_path("slow-semantic-request", "txt");
    let marker_json = serde_json::to_string(&marker.to_string_lossy()).unwrap();
    fs::write(
        &worker,
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
    return;
  }}
  fs.writeFileSync(marker, "running");
  setTimeout(() => process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload: {{ completion: [] }}, error: null }})}}\n`), 700);
}});
"#,
        ),
    )
    .unwrap();
    let mut settings = default_settings();
    settings.sdk.semantic_worker_path = worker.to_string_lossy().to_string();
    let runtime = LanguageRuntime::default();
    let slow_runtime = runtime.clone();
    let slow_settings = settings.clone();
    let query = LanguageQueryRequest {
        path: "/workspace/main.ets".to_string(),
        line: 1,
        column: 1,
        content: None,
    };
    let slow_query = query.clone();
    let request_thread =
        std::thread::spawn(move || complete_symbol(&slow_runtime, &slow_settings, &slow_query));

    let deadline = Instant::now() + Duration::from_secs(2);
    while !marker.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(marker.exists(), "semantic request should have started");
    let started = Instant::now();
    let _ = hover_symbol(&runtime, &settings, &query);

    assert!(started.elapsed() < Duration::from_millis(200));
    request_thread.join().unwrap();
    fs::remove_file(marker).unwrap();
    fs::remove_file(worker).unwrap();
}
