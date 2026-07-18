use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

fn changed_task(root_path: &str, paths: &[&str]) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: paths.iter().map(|path| path.to_string()).collect(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "watcher".to_string(),
    }
}

fn sdk_task(root_path: &str, sdk_path: &str) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: Some(sdk_path.to_string()),
        sdk_version: Some("test-sdk".to_string()),
        generation: 0,
        reason: "sdk-apply".to_string(),
    }
}

fn refresh_task(root_path: &str, priority: WorkspaceIndexTaskPriority) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "test".to_string(),
    }
}

fn changed_paths_task(
    root_path: &str,
    priority: WorkspaceIndexTaskPriority,
    reason: &str,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority,
        changed_paths: vec!["A.ets".to_string()],
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: reason.to_string(),
    }
}

#[test]
fn coalesces_and_deduplicates_changed_paths_for_the_same_root() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    scheduler.schedule(changed_task("/workspace", &["B.ets", "A.ets"]));
    scheduler.schedule(changed_task("/workspace", &["B.ets", "C.ets"]));
    let tasks = scheduler.drain_ready();

    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].changed_paths, vec!["A.ets", "B.ets", "C.ets"]);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
}

#[test]
fn ignores_duplicate_changed_path_subsets_without_generation_churn() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    let first = scheduler.schedule_with_result(changed_task("/workspace", &["A.ets", "B.ets"]));
    let second = scheduler.schedule_with_result(changed_task("/workspace", &["B.ets"]));
    let tasks = scheduler.drain_ready();

    assert!(first.scheduled);
    assert!(!second.scheduled);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].generation, 1);
    assert_eq!(tasks[0].changed_paths, vec!["A.ets", "B.ets"]);
}

#[test]
fn drops_empty_changed_path_tasks_before_they_enter_the_queue() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    let cancelled = scheduler.schedule(changed_task("/workspace", &[]));

    assert!(cancelled.is_empty());
    assert!(!scheduler.has_pending_tasks());
}

#[test]
fn keeps_empty_discovery_tasks_because_they_start_root_enumeration() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    let mut task = changed_task("/workspace", &[]);
    task.priority = WorkspaceIndexTaskPriority::VisibleFiles;
    task.reason = "workspace-discovery".to_string();

    scheduler.schedule(task);
    let tasks = scheduler.drain_ready();

    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(tasks[0].reason, "workspace-discovery");
    assert!(tasks[0].changed_paths.is_empty());
}

#[test]
fn preserves_discovery_generation_for_cursor_continuations() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    let mut initial = changed_task("/workspace", &[]);
    initial.priority = WorkspaceIndexTaskPriority::VisibleFiles;
    initial.reason = "workspace-discovery".to_string();
    scheduler.schedule(initial);
    let initial = scheduler.drain_ready().remove(0);

    scheduler.schedule(changed_task("/other-workspace", &["Other.ets"]));
    scheduler.drain_ready();

    let mut continuation = initial.clone();
    continuation.changed_paths = vec!["/workspace/entry".to_string()];
    scheduler.schedule(continuation);
    let continuation = scheduler.drain_ready().remove(0);

    assert_eq!(continuation.generation, initial.generation);
}

#[test]
fn keeps_changed_path_tasks_for_different_roots_separate() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    scheduler.schedule(changed_task("/workspace-a", &["A.ets"]));
    scheduler.schedule(changed_task("/workspace-b", &["B.ets"]));
    let tasks = scheduler.drain_ready();

    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().any(|task| task.root_path == "/workspace-a"));
    assert!(tasks.iter().any(|task| task.root_path == "/workspace-b"));
}

#[test]
fn drains_user_blocking_tasks_before_background_work() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    scheduler.schedule(refresh_task(
        "/workspace-a",
        WorkspaceIndexTaskPriority::Background,
    ));
    scheduler.schedule(WorkspaceIndexTask {
        root_path: "/workspace-b".to_string(),
        kind: WorkspaceIndexTaskKind::OpenWorkspace,
        priority: WorkspaceIndexTaskPriority::UserBlocking,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "open".to_string(),
    });

    let tasks = scheduler.drain_ready();

    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::OpenWorkspace);
    assert_eq!(tasks[1].kind, WorkspaceIndexTaskKind::RefreshWorkspace);
}

#[test]
fn drains_ide_priority_classes_in_foreground_first_order() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    for (root_path, priority) in [
        ("/background", WorkspaceIndexTaskPriority::Background),
        ("/sdk", WorkspaceIndexTaskPriority::SdkIndexing),
        ("/full", WorkspaceIndexTaskPriority::FullRefresh),
        ("/changed", WorkspaceIndexTaskPriority::ChangedFiles),
        ("/visible", WorkspaceIndexTaskPriority::VisibleFiles),
        (
            "/completion",
            WorkspaceIndexTaskPriority::ForegroundCompletion,
        ),
        (
            "/navigation",
            WorkspaceIndexTaskPriority::ForegroundNavigation,
        ),
    ] {
        scheduler.schedule(refresh_task(root_path, priority));
    }

    let roots = scheduler
        .drain_ready()
        .into_iter()
        .map(|task| task.root_path)
        .collect::<Vec<_>>();

    assert_eq!(
        roots,
        vec![
            "/navigation",
            "/completion",
            "/visible",
            "/changed",
            "/full",
            "/sdk",
            "/background",
        ]
    );
}

#[test]
fn drains_bounded_batches_without_dropping_remaining_tasks() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    for root_path in ["/workspace-a", "/workspace-b", "/workspace-c"] {
        scheduler.schedule(WorkspaceIndexTask {
            reason: "manual".to_string(),
            ..refresh_task(root_path, WorkspaceIndexTaskPriority::FullRefresh)
        });
    }

    let first_batch = scheduler.drain_ready_batch(2);
    let second_batch = scheduler.drain_ready_batch(2);

    assert_eq!(first_batch.len(), 1);
    assert_eq!(
        first_batch
            .iter()
            .map(|task| task.root_path.as_str())
            .collect::<Vec<_>>(),
        vec!["/workspace-a"]
    );
    assert_eq!(second_batch.len(), 1);
    assert_eq!(second_batch[0].root_path, "/workspace-b");
    assert!(scheduler.has_pending_tasks());
}

#[test]
fn bounded_batches_run_foreground_work_without_background_tail() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    scheduler.schedule(WorkspaceIndexTask {
        root_path: "/workspace".to_string(),
        kind: WorkspaceIndexTaskKind::OpenWorkspace,
        priority: WorkspaceIndexTaskPriority::ForegroundNavigation,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "open".to_string(),
    });
    scheduler.schedule(WorkspaceIndexTask {
        reason: "background-refresh-after-open".to_string(),
        ..refresh_task("/workspace", WorkspaceIndexTaskPriority::FullRefresh)
    });

    let foreground_batch = scheduler.drain_ready_batch(8);
    let background_batch = scheduler.drain_ready_batch(8);

    assert_eq!(foreground_batch.len(), 1);
    assert_eq!(
        foreground_batch[0].kind,
        WorkspaceIndexTaskKind::OpenWorkspace
    );
    assert_eq!(background_batch.len(), 1);
    assert_eq!(
        background_batch[0].kind,
        WorkspaceIndexTaskKind::RefreshWorkspace
    );
}

#[test]
fn bounded_batches_run_full_refresh_without_background_tail() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    scheduler.schedule(changed_paths_task(
        "/workspace",
        WorkspaceIndexTaskPriority::FullRefresh,
        "full-refresh-files:refresh-workspace",
    ));
    scheduler.schedule(changed_paths_task(
        "/workspace",
        WorkspaceIndexTaskPriority::Background,
        "full-refresh-deep:refresh-workspace",
    ));

    let full_refresh_batch = scheduler.drain_ready_batch(8);
    let background_batch = scheduler.drain_ready_batch(8);

    assert_eq!(full_refresh_batch.len(), 1);
    assert_eq!(background_batch.len(), 1);
    assert_eq!(
        full_refresh_batch[0].reason,
        "full-refresh-files:refresh-workspace"
    );
    assert_eq!(
        background_batch[0].reason,
        "full-refresh-deep:refresh-workspace"
    );
}

#[test]
fn keeps_changed_path_tasks_with_different_reasons_separate() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    scheduler.schedule(changed_paths_task(
        "/workspace",
        WorkspaceIndexTaskPriority::FullRefresh,
        "full-refresh-files:refresh-workspace",
    ));
    scheduler.schedule(changed_paths_task(
        "/workspace",
        WorkspaceIndexTaskPriority::Background,
        "full-refresh-deep:refresh-workspace",
    ));

    let tasks = scheduler.drain_ready();

    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0].reason, "full-refresh-files:refresh-workspace");
    assert_eq!(tasks[1].reason, "full-refresh-deep:refresh-workspace");
}

#[test]
fn wider_refresh_replaces_pending_changed_paths_for_the_same_root() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    let first_cancelled = scheduler.schedule(changed_task("/workspace", &["A.ets"]));
    let second_cancelled = scheduler.schedule(WorkspaceIndexTask {
        root_path: "/workspace".to_string(),
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "manual".to_string(),
    });
    let tasks = scheduler.drain_ready();

    assert!(first_cancelled.is_empty());
    assert_eq!(second_cancelled.len(), 1);
    assert_eq!(
        second_cancelled[0].kind,
        WorkspaceIndexTaskKind::ChangedPaths
    );
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::RefreshWorkspace);
    assert!(tasks[0].generation > 0);
    assert!(tasks[0].generation > second_cancelled[0].generation);
}

#[test]
fn replaces_queued_sdk_task_for_the_same_root() {
    let mut scheduler = WorkspaceIndexScheduler::default();

    let first_cancelled = scheduler.schedule(sdk_task("/workspace", "/sdk/old"));
    let second_cancelled = scheduler.schedule(sdk_task("/workspace", "/sdk/new"));
    let tasks = scheduler.drain_ready();

    assert!(first_cancelled.is_empty());
    assert_eq!(second_cancelled.len(), 1);
    assert_eq!(second_cancelled[0].sdk_path.as_deref(), Some("/sdk/old"));
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].sdk_path.as_deref(), Some("/sdk/new"));
    assert!(tasks[0].generation > second_cancelled[0].generation);
}
