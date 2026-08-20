use std::fs;
use std::thread;
use std::time::Duration;

use crate::indexer_host::IndexerHostRuntime;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_deep_sidecar_service::{
    update_background_deep_layer, WorkspaceDeepLayerUpdate,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_worker_sidecar_fallback_tests::unique_temp_dir;

#[test]
fn repeatedly_crashing_sidecar_stops_retrying_the_background_refresh() {
    let root = unique_temp_dir("indexer-crashing-sidecar-terminal");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    let executable = root.join("crashing-indexer");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    fs::write(&executable, "not an executable").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: vec![source_path.clone()],
        sdk_path: None,
        sdk_version: None,
        generation: 9,
        reason: "full-refresh-deep:crashing-sidecar".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(executable);

    let first = update_background_deep_layer(
        &runtime,
        Some(&indexer),
        &task,
        &token,
        std::slice::from_ref(&source_path),
        &[],
        false,
        &|| false,
    )
    .unwrap();
    thread::sleep(Duration::from_millis(300));
    let second = update_background_deep_layer(
        &runtime,
        Some(&indexer),
        &task,
        &token,
        std::slice::from_ref(&source_path),
        &[],
        false,
        &|| false,
    )
    .unwrap();
    thread::sleep(Duration::from_millis(550));
    let third = update_background_deep_layer(
        &runtime,
        Some(&indexer),
        &task,
        &token,
        std::slice::from_ref(&source_path),
        &[],
        false,
        &|| false,
    )
    .unwrap();

    assert!(matches!(first, WorkspaceDeepLayerUpdate::Deferred(_)));
    assert!(matches!(second, WorkspaceDeepLayerUpdate::Deferred(_)));
    assert!(matches!(third, WorkspaceDeepLayerUpdate::Failed(_)));
    assert_eq!(indexer.snapshot().consecutive_failure_count, 3);
    fs::remove_dir_all(root).unwrap();
}
