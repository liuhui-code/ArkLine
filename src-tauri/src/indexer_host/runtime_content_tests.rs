use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::{IndexerContentRefreshAttempt, IndexerHostRuntime};
use crate::indexer_sidecar::{IndexerTaskKey, INDEXER_PROTOCOL_VERSION};

#[test]
fn cancelling_slow_content_refresh_does_not_count_as_fallback() {
    let root = std::env::temp_dir().join(format!(
        "arkline-indexer-content-cancel-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("slow-indexer.sh");
    let root_path = root.to_string_lossy().to_string();
    let task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "content-refresh".to_string(),
        generation: 3,
        reason: "content-cancel-test".to_string(),
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
        "id": "indexer-refreshContentChunk-2",
        "ok": true,
        "payload": {
            "task": task,
            "indexedGeneration": 3,
            "changedPathCount": 1,
            "removedPathCount": 0,
            "indexedFileCount": 1,
            "indexedLineCount": 1,
            "unreadableFileCount": 0,
            "resourceLimitedFileCount": 0,
            "processedSourceBytes": 1
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
    let source = format!("{root_path}/Entry.ets");
    let worker = thread::spawn(move || {
        worker_runtime.refresh_content_chunk(task, 3, vec![source], Vec::new(), || {
            worker_polling_started.store(true, Ordering::SeqCst);
            worker_cancelled.load(Ordering::SeqCst)
        })
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while !polling_started.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(polling_started.load(Ordering::SeqCst));

    let cancel_started = Instant::now();
    cancelled.store(true, Ordering::SeqCst);
    assert_eq!(
        worker.join().unwrap(),
        IndexerContentRefreshAttempt::Cancelled
    );
    assert!(cancel_started.elapsed() < Duration::from_millis(500));
    let snapshot = runtime.snapshot();
    assert_eq!(snapshot.status, "idle");
    assert_eq!(snapshot.cancelled_content_refresh_chunks, 1);
    assert_eq!(snapshot.completed_content_refresh_chunks, 0);
    assert_eq!(snapshot.fallback_count, 0);
    assert!(snapshot.process_id.is_none());
    fs::remove_dir_all(root).unwrap();
}
