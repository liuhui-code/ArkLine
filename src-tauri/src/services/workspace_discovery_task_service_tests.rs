use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_discovery_task_service::{
    discovery_task_kind_label, discovery_task_reason, is_workspace_discovery_task_reason,
    workspace_discovery_task, workspace_discovery_task_cursor,
    workspace_discovery_task_with_cursor,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

#[test]
fn discovery_task_reason_is_stable_and_identifiable() {
    let reason = discovery_task_reason();

    assert_eq!(reason, "workspace-discovery");
    assert!(is_workspace_discovery_task_reason(reason));
    assert!(!is_workspace_discovery_task_reason("full-refresh"));
}

#[test]
fn workspace_discovery_task_uses_index_scheduler_contract() {
    let task = workspace_discovery_task("/tmp/project", 42);

    assert_eq!(task.root_path, "/tmp/project");
    assert_eq!(task.kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(task.priority, WorkspaceIndexTaskPriority::VisibleFiles);
    assert_eq!(task.reason, "workspace-discovery");
    assert!(task.changed_paths.is_empty());
    assert_eq!(task.generation, 42);
}

#[test]
fn discovery_task_kind_label_is_user_visible() {
    assert_eq!(discovery_task_kind_label(), "discovery");
}

#[test]
fn workspace_discovery_task_can_resume_from_cursor() {
    let cursor = WorkspaceDiscoveryCursor {
        pending_directories: vec!["entry".to_string(), "feature".to_string()],
    };

    let task = workspace_discovery_task_with_cursor("/tmp/project", 43, Some(cursor.clone()));
    let restored = workspace_discovery_task_cursor(&task).unwrap();

    assert_eq!(task.changed_paths, cursor.pending_directories);
    assert_eq!(restored, cursor);
}
