use std::fs;

use crate::indexer_host::IndexerHostRuntime;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;
use crate::services::workspace_index_worker_service::run_index_tasks_with_cancellation_and_ui_activity_and_indexer;
use crate::services::workspace_index_worker_sidecar_fallback_tests::unique_temp_dir;

#[test]
fn isolated_open_workspace_delegates_without_a_host_root_scan() {
    let root = unique_temp_dir("indexer-open-delegation");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Entry.ets"), "struct Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let task = task(
        &root_path,
        WorkspaceIndexTaskKind::OpenWorkspace,
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        Vec::new(),
        "open-workspace",
    );
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let results = run(&task, token, &indexer);

    assert_eq!(results[0].status, "skipped");
    assert!(results[0].message.as_deref().unwrap().contains("delegated"));
    assert!(!root
        .join(".arkline/index/workspace-catalog.sqlite")
        .exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn foreground_navigation_publishes_only_the_current_file_layer() {
    let root = unique_temp_dir("indexer-foreground-file-layer");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let task = task(
        &root_path,
        WorkspaceIndexTaskKind::ChangedPaths,
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        vec![source.to_string_lossy().to_string()],
        "foreground-navigation",
    );
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let indexer = IndexerHostRuntime::with_executable(root.join("missing-indexer"));

    let results = run(&task, token, &indexer);

    assert_eq!(results[0].status, "partial");
    assert_eq!(
        results[0]
            .refresh_result
            .as_ref()
            .unwrap()
            .added_paths
            .len(),
        1
    );
    assert_eq!(indexer.snapshot().degraded_count, 0);
    let readiness =
        get_workspace_index_file_readiness(&root_path, source.to_str().unwrap()).unwrap();
    assert_eq!(readiness.file_index, "ready");
    assert_eq!(readiness.symbol_index, "missing");
    assert_eq!(readiness.content_index, "missing");
    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    let lexical_symbols: i64 = connection
        .query_row(
            "select count(*) from workspace_symbols where name = 'EntryController'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let stubs: i64 = connection
        .query_row(
            "select count(*) from workspace_stub_declarations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(lexical_symbols, 1);
    assert_eq!(stubs, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

fn run(
    task: &WorkspaceIndexTask,
    token: WorkspaceIndexCancellationToken,
    indexer: &IndexerHostRuntime,
) -> Vec<WorkspaceIndexTaskResult> {
    run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
        &WorkspaceIndexRuntime::default(),
        vec![(task.clone(), token)],
        |_| Ok(()),
        || false,
        Some(indexer),
    )
    .unwrap()
}

fn task(
    root_path: &str,
    kind: WorkspaceIndexTaskKind,
    priority: WorkspaceIndexTaskPriority,
    changed_paths: Vec<String>,
    reason: &str,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind,
        priority,
        changed_paths,
        sdk_path: None,
        sdk_version: None,
        generation: 1,
        reason: reason.to_string(),
    }
}
