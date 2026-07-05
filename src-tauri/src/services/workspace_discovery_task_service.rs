use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

const WORKSPACE_DISCOVERY_REASON: &str = "workspace-discovery";

pub fn discovery_task_reason() -> &'static str {
    WORKSPACE_DISCOVERY_REASON
}

pub fn is_workspace_discovery_task_reason(reason: &str) -> bool {
    reason == WORKSPACE_DISCOVERY_REASON
}

pub fn discovery_task_kind_label() -> &'static str {
    "discovery"
}

pub fn workspace_discovery_task(root_path: &str, generation: u64) -> WorkspaceIndexTask {
    workspace_discovery_task_with_cursor(root_path, generation, None)
}

pub fn workspace_discovery_task_with_cursor(
    root_path: &str,
    generation: u64,
    cursor: Option<WorkspaceDiscoveryCursor>,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::VisibleFiles,
        changed_paths: cursor
            .map(|cursor| cursor.pending_directories)
            .unwrap_or_default(),
        sdk_path: None,
        sdk_version: None,
        generation,
        reason: WORKSPACE_DISCOVERY_REASON.to_string(),
    }
}

pub fn workspace_discovery_task_cursor(
    task: &WorkspaceIndexTask,
) -> Option<WorkspaceDiscoveryCursor> {
    if task.changed_paths.is_empty() {
        return None;
    }
    Some(WorkspaceDiscoveryCursor {
        pending_directories: task.changed_paths.clone(),
    })
}
