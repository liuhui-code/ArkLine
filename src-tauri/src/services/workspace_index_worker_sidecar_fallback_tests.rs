use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::indexer_host::IndexerHostRuntime;
use crate::services::workspace_content_refresh_service::update_workspace_content_at_generation;
use crate::services::workspace_discovery_store_service::load_ready_discovered_files;
use crate::services::workspace_discovery_task_service::workspace_discovery_task;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_catalog_refresh_worker_service::CATALOG_DEEP_REFRESH_MESSAGE;
use crate::services::workspace_index_deep_refresh_cursor_service::load_deep_refresh_cursor;
use crate::services::workspace_index_deep_sidecar_service::{
    update_background_deep_layer, WorkspaceDeepLayerUpdate,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_worker_service::run_index_tasks_with_cancellation_and_ui_activity_and_indexer;
use crate::services::workspace_service::scan_workspace;

#[path = "workspace_index_worker_sidecar_terminal_tests.rs"]
mod terminal;

#[test]
fn unavailable_sidecar_falls_back_to_local_discovery_without_losing_the_task() {
    let root = unique_temp_dir("indexer-sidecar-fallback");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Entry.ets"), "struct Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let task = workspace_discovery_task(&root_path, 7);
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let results = run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &WorkspaceIndexRuntime::default(),
        vec![(task, token)],
        |_| Ok(()),
        || false,
        Some(&indexer),
    )
    .unwrap();
    let files = load_ready_discovered_files(&root_path, 10)
        .unwrap()
        .expect("local fallback should publish ready discovery");
    let snapshot = indexer.snapshot();

    assert_eq!(results[0].status, "ready");
    assert_eq!(files.len(), 1);
    assert!(matches!(snapshot.status.as_str(), "backoff" | "degraded"));
    if snapshot.status == "backoff" {
        assert!(snapshot.backoff_remaining_ms.is_some());
    }
    assert_eq!(snapshot.fallback_count, 1);
    assert_eq!(snapshot.degraded_count, 1);
    assert!(snapshot
        .last_error
        .unwrap()
        .contains("Failed to launch indexer"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_local_compatibility_mode_still_indexes_content_and_stubs() {
    let root = unique_temp_dir("indexer-local-compatibility");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class LocalController {}\n").unwrap();
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
        generation: 8,
        reason: "full-refresh-deep:compatibility".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::local_compatibility();

    let outcome = update_background_deep_layer(
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

    assert!(matches!(outcome, WorkspaceDeepLayerUpdate::Applied(_)));
    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let content_count: i64 = connection
        .query_row("select count(*) from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    let declaration_count: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations where name = 'LocalController'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(content_count, 1);
    assert_eq!(declaration_count, 1);
    assert_eq!(indexer.snapshot().degraded_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_sidecar_terminates_background_refresh_with_actionable_degraded_state() {
    let root = unique_temp_dir("indexer-stub-sidecar-fallback");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .update_workspace_file_symbol_layer(&root_path, &[source_path.clone()], &[])
        .unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: vec![source_path],
        sdk_path: None,
        sdk_version: None,
        generation: 8,
        reason: "full-refresh-deep:test".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let results = run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &runtime,
        vec![(task, token)],
        |_| Ok(()),
        || false,
        Some(&indexer),
    )
    .unwrap();
    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let declaration_count: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations where name = 'EntryController'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let content_count: i64 = connection
        .query_row(
            "select count(*) from workspace_content_files where status = 'ready'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let snapshot = indexer.snapshot();
    let state = runtime.get_index_state(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].status, "failed");
    assert!(results[0]
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("Failed to launch indexer"));
    assert!(state
        .partial_reason
        .as_deref()
        .unwrap_or_default()
        .contains("Indexer sidecar"));
    assert_eq!(content_count, 0);
    assert_eq!(declaration_count, 0);
    assert_eq!(snapshot.fallback_count, 0);
    assert_eq!(snapshot.degraded_count, 1);
    assert_eq!(snapshot.completed_content_refresh_chunks, 0);
    assert!(snapshot
        .last_error
        .unwrap()
        .contains("Failed to launch indexer"));

    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminal_sidecar_failure_preserves_newer_persisted_layer_generation() {
    let root = unique_temp_dir("indexer-sidecar-generation-rebase");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let state = runtime
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let newer_generation = state.indexed_at.unwrap() as u64 + 1_000;
    update_workspace_content_at_generation(
        &root_path,
        std::slice::from_ref(&source_path),
        &[],
        newer_generation,
    )
    .unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: vec![source_path],
        sdk_path: None,
        sdk_version: None,
        generation: 9,
        reason: "full-refresh-deep:generation-rebase".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let outcome = update_background_deep_layer(
        &runtime,
        Some(&indexer),
        &task,
        &token,
        std::slice::from_ref(&task.changed_paths[0]),
        &[],
        false,
        &|| false,
    )
    .unwrap();

    assert!(matches!(outcome, WorkspaceDeepLayerUpdate::Failed(_)));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn deep_refresh_waits_for_persisted_file_catalog_before_sidecar_rpc() {
    let root = unique_temp_dir("indexer-stub-catalog-preflight");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let snapshot = scan_workspace(&root).unwrap();
    runtime
        .index_workspace_snapshot_for_open(&snapshot)
        .unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: vec![source_path],
        sdk_path: None,
        sdk_version: None,
        generation: 9,
        reason: "full-refresh-deep:preflight".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &runtime,
        vec![(task, token)],
        |_| Ok(()),
        || false,
        Some(&indexer),
    )
    .unwrap();

    assert_eq!(indexer.snapshot().fallback_count, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancelled_deep_refresh_does_not_publish_or_fall_back_locally() {
    let root = unique_temp_dir("indexer-stub-cancelled");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .update_workspace_file_symbol_layer(&root_path, &[source_path.clone()], &[])
        .unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: vec![source_path.clone()],
        sdk_path: None,
        sdk_version: None,
        generation: 10,
        reason: "full-refresh-deep:cancelled".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    token.cancel();
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let outcome = update_background_deep_layer(
        &runtime,
        Some(&indexer),
        &task,
        &token,
        &[source_path],
        &[],
        false,
        &|| false,
    )
    .unwrap();
    assert!(matches!(outcome, WorkspaceDeepLayerUpdate::Cancelled));

    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let content_count: i64 = connection
        .query_row("select count(*) from workspace_content_lines", [], |row| {
            row.get(0)
        })
        .unwrap();
    let declaration_count: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(content_count, 0);
    assert_eq!(declaration_count, 0);
    let indexer = indexer.snapshot();
    assert_eq!(indexer.fallback_count, 0);
    assert_eq!(indexer.completed_content_refresh_chunks, 0);
    assert_eq!(indexer.completed_stub_refresh_chunks, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn watcher_delta_fails_terminally_without_host_deep_refresh_or_root_rescan() {
    let root = unique_temp_dir("indexer-watcher-delta-fallback");
    fs::create_dir_all(&root).unwrap();
    let changed = root.join("Changed.ets");
    let removed = root.join("Removed.ets");
    let unreported = root.join("Unreported.ets");
    fs::write(&changed, "export class BeforeChange {}\n").unwrap();
    fs::write(&removed, "export class RemovedController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = changed.to_string_lossy().to_string();
    let removed_path = removed.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(&changed, "export class AfterChange {}\n").unwrap();
    fs::remove_file(&removed).unwrap();
    fs::write(&unreported, "export class Unreported {}\n").unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::ChangedFiles,
        changed_paths: vec![changed_path.clone(), removed_path.clone()],
        sdk_path: None,
        sdk_version: None,
        generation: 50,
        reason: "watcher".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let results = run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &runtime,
        vec![(task, token)],
        |_| Ok(()),
        || false,
        Some(&indexer),
    )
    .unwrap();

    assert_eq!(results[0].status, "failed");
    assert_eq!(indexer.snapshot().fallback_count, 0);
    assert_eq!(indexer.snapshot().degraded_count, 1);
    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let changed_text: String = connection
        .query_row(
            "select text from workspace_content_lines where path = ?1",
            [changed_path.replace('/', "\\")],
            |row| row.get(0),
        )
        .unwrap();
    assert!(changed_text.contains("BeforeChange"));
    let removed_rows: i64 = connection
        .query_row(
            "select count(*) from workspace_content_files where path = ?1",
            [removed_path.replace('/', "\\")],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        removed_rows, 1,
        "degraded deep layers retain the last durable snapshot until sidecar recovery"
    );
    let unreported_rows: i64 = connection
        .query_row(
            "select count(*) from workspace_files where path = ?1",
            [unreported.to_string_lossy().replace('/', "\\")],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unreported_rows, 0, "watcher delta must not rescan the root");
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn background_deep_refresh_yields_when_ui_becomes_active_after_task_start() {
    let root = unique_temp_dir("indexer-sidecar-ui-yield");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
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
        changed_paths: vec![source_path],
        sdk_path: None,
        sdk_version: None,
        generation: 51,
        reason: "full-refresh-deep:dynamic-ui-activity".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));
    let activity_checks = AtomicUsize::new(0);

    let results = run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &runtime,
        vec![(task, token)],
        |_| Ok(()),
        || activity_checks.fetch_add(1, Ordering::SeqCst) > 0,
        Some(&indexer),
    )
    .unwrap();

    assert_eq!(results[0].status, "partial");
    assert!(results[0]
        .message
        .as_deref()
        .is_some_and(|message| message == CATALOG_DEEP_REFRESH_MESSAGE));
    assert!(results[0].refresh_continuation.is_none());
    assert!(
        load_deep_refresh_cursor(&root_path, "full-refresh-deep:dynamic-ui-activity")
            .unwrap()
            .is_some()
    );
    assert!(activity_checks.load(Ordering::SeqCst) >= 2);
    assert_eq!(indexer.snapshot().degraded_count, 0);
    fs::remove_dir_all(root).unwrap();
}

pub(crate) fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}
