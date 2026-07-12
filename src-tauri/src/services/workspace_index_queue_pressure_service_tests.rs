use crate::services::workspace_index_queue_pressure_service::project_queue_pressure;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

fn task(
    root_path: &str,
    kind: WorkspaceIndexTaskKind,
    priority: WorkspaceIndexTaskPriority,
    generation: u64,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind,
        priority,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation,
        reason: "test".to_string(),
    }
}

#[test]
fn queue_pressure_projects_global_and_workspace_pending_tasks() {
    let root_path = "/workspace/first";
    let tasks = vec![
        task(
            root_path,
            WorkspaceIndexTaskKind::RefreshWorkspace,
            WorkspaceIndexTaskPriority::FullRefresh,
            1,
        ),
        task(
            root_path,
            WorkspaceIndexTaskKind::ChangedPaths,
            WorkspaceIndexTaskPriority::VisibleFiles,
            2,
        ),
        task(
            "/workspace/second",
            WorkspaceIndexTaskKind::IndexSdk,
            WorkspaceIndexTaskPriority::SdkIndexing,
            3,
        ),
    ];

    let pressure = project_queue_pressure(root_path, &tasks);

    assert_eq!(pressure.root_path, root_path);
    assert_eq!(pressure.pending_task_count, 3);
    assert_eq!(pressure.workspace_pending_task_count, 2);
    assert_eq!(pressure.highest_priority.as_deref(), Some("visibleFiles"));
    assert_eq!(
        pressure.highest_priority_task_kind.as_deref(),
        Some("changed-paths")
    );
}

#[test]
fn queue_pressure_reports_empty_queue_without_priority_labels() {
    let pressure = project_queue_pressure("/workspace/empty", &[]);

    assert_eq!(pressure.root_path, "/workspace/empty");
    assert_eq!(pressure.pending_task_count, 0);
    assert_eq!(pressure.workspace_pending_task_count, 0);
    assert!(pressure.highest_priority.is_none());
    assert!(pressure.highest_priority_task_kind.is_none());
}
