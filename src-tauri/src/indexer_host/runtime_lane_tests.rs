use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use super::{IndexerContentRefreshAttempt, IndexerHostRuntime, IndexerStubRefreshAttempt};
use crate::indexer_sidecar::{IndexerTaskKey, INDEXER_PROTOCOL_VERSION};

#[test]
fn content_and_stub_requests_use_independent_process_lanes() {
    let root = std::env::temp_dir().join(format!("arkline-indexer-lanes-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("lane-indexer.sh");
    let root_path = root.to_string_lossy().to_string();
    let task = IndexerTaskKey {
        root_path: root_path.clone(),
        kind: "deep-refresh".to_string(),
        generation: 7,
        reason: "lane-test".to_string(),
    };
    fs::write(&executable, lane_script(&task, &root)).unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&executable, permissions).unwrap();

    let runtime = Arc::new(IndexerHostRuntime::with_executable(executable));
    let source = root.join("Entry.ets").to_string_lossy().to_string();
    let (content, stub) = std::thread::scope(|scope| {
        let content_runtime = runtime.clone();
        let content_task = task.clone();
        let content_source = source.clone();
        let content = scope.spawn(move || {
            content_runtime.refresh_content_chunk(
                content_task,
                7,
                vec![content_source],
                Vec::new(),
                || false,
            )
        });
        let stub_runtime = runtime.clone();
        let stub = scope.spawn(move || {
            stub_runtime.refresh_stub_chunk(task, 7, vec![source], Vec::new(), || false)
        });
        (content.join().unwrap(), stub.join().unwrap())
    });

    assert!(matches!(content, IndexerContentRefreshAttempt::Applied(_)));
    assert!(matches!(stub, IndexerStubRefreshAttempt::Applied(_)));
    let snapshot = runtime.snapshot();
    assert_ne!(snapshot.content_process_id, snapshot.stub_process_id);
    assert!(snapshot.content_process_id.is_some());
    assert!(snapshot.stub_process_id.is_some());
    fs::remove_dir_all(root).unwrap();
}

fn lane_script(task: &IndexerTaskKey, root: &std::path::Path) -> String {
    let health = serde_json::json!({
        "id": "indexer-health-1",
        "ok": true,
        "payload": {
            "status": "ready",
            "protocolVersion": INDEXER_PROTOCOL_VERSION,
            "capabilities": ["health", "discoveryChunk", "contentRefreshChunk", "contentResourceBudget", "stubRefreshChunk"]
        }
    });
    let content = serde_json::json!({
        "id": "indexer-refreshContentChunk-2",
        "ok": true,
        "payload": {
            "task": task,
            "indexedGeneration": 7,
            "changedPathCount": 1,
            "removedPathCount": 0,
            "indexedFileCount": 1,
            "indexedLineCount": 1,
            "unreadableFileCount": 0,
            "resourceLimitedFileCount": 0,
            "processedSourceBytes": 1
        }
    });
    let stub = serde_json::json!({
        "id": "indexer-refreshStubChunk-2",
        "ok": true,
        "payload": {
            "task": task,
            "indexedGeneration": 7,
            "changedPathCount": 1,
            "removedPathCount": 0,
            "parsedFileCount": 1,
            "parseErrorCount": 0
        }
    });
    format!(
        "#!/bin/sh\nread line\nprintf '%s\\n' '{}'\nread request\ncase \"$request\" in\n  *refreshContentChunk*) touch '{}/content.started' ;;\n  *) touch '{}/stub.started' ;;\nesac\ncount=0\nwhile [ ! -f '{}/content.started' ] || [ ! -f '{}/stub.started' ]; do\n  sleep 0.01\n  count=$((count + 1))\n  [ \"$count\" -gt 500 ] && exit 2\ndone\ncase \"$request\" in\n  *refreshContentChunk*) printf '%s\\n' '{}' ;;\n  *) printf '%s\\n' '{}' ;;\nesac\n",
        health,
        root.display(),
        root.display(),
        root.display(),
        root.display(),
        content,
        stub
    )
}
