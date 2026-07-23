use crate::services::workspace_index_cancellation_service::{
    WorkspaceIndexCancellationRegistry, WorkspaceIndexCancellationToken,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

fn task(root_path: &str, kind: WorkspaceIndexTaskKind, generation: u64) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation,
        reason: "test".to_string(),
    }
}

#[test]
fn cancellation_token_starts_active() {
    let token = WorkspaceIndexCancellationToken::new(7);

    assert_eq!(token.generation(), 7);
    assert!(!token.is_cancelled());
}

#[test]
fn cancellation_token_reports_cancelled_after_cancel() {
    let token = WorkspaceIndexCancellationToken::new(7);

    token.cancel();

    assert!(token.is_cancelled());
}

#[test]
fn registry_cancels_active_task_superseded_by_new_task() {
    let mut registry = WorkspaceIndexCancellationRegistry::default();
    let changed_paths = task("/workspace", WorkspaceIndexTaskKind::ChangedPaths, 1);
    let refresh = task("/workspace", WorkspaceIndexTaskKind::RefreshWorkspace, 2);

    let token = registry.start_task(&changed_paths);
    let cancelled = registry.cancel_superseded_by(&refresh);

    assert!(token.is_cancelled());
    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled[0].generation(), 1);
}

#[test]
fn registry_keeps_active_task_for_independent_workspace() {
    let mut registry = WorkspaceIndexCancellationRegistry::default();
    let changed_paths = task("/workspace-a", WorkspaceIndexTaskKind::ChangedPaths, 1);
    let refresh = task("/workspace-b", WorkspaceIndexTaskKind::RefreshWorkspace, 2);

    let token = registry.start_task(&changed_paths);
    let cancelled = registry.cancel_superseded_by(&refresh);

    assert!(!token.is_cancelled());
    assert!(cancelled.is_empty());
}

#[test]
fn registry_cancels_every_active_task_for_a_rebuilt_workspace() {
    let mut registry = WorkspaceIndexCancellationRegistry::default();
    let first = registry.start_task(&task("/workspace", WorkspaceIndexTaskKind::ChangedPaths, 1));
    let second = registry.start_task(&task("/workspace", WorkspaceIndexTaskKind::IndexSdk, 2));
    let independent =
        registry.start_task(&task("/other", WorkspaceIndexTaskKind::RefreshWorkspace, 3));

    let cancelled = registry.cancel_root("/workspace");

    assert_eq!(cancelled.len(), 2);
    assert!(first.is_cancelled());
    assert!(second.is_cancelled());
    assert!(!independent.is_cancelled());
}
