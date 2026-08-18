use tauri::{AppHandle, Emitter};

use crate::models::workspace::{
    WorkspaceIndexEvent, WorkspaceIndexRefreshResult, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceIndexTaskStatus,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_watcher_service::WORKSPACE_INDEX_CHANGED_EVENT;

pub(crate) fn emit_workspace_index_task_update(
    app_handle: &AppHandle,
    index_runtime: &WorkspaceIndexRuntime,
    status: WorkspaceIndexTaskStatus,
) {
    let _ = app_handle.emit("workspace-index-task-updated", &status);
    if status.status != "ready" {
        return;
    }
    let Ok(state) = index_runtime.get_index_state(&status.root_path) else {
        return;
    };
    if !should_emit_workspace_index_state(&status.status, &state) {
        return;
    }
    let _ = app_handle.emit(
        WORKSPACE_INDEX_CHANGED_EVENT,
        WorkspaceIndexRefreshResult {
            state,
            changed: true,
            added_paths: Vec::new(),
            removed_paths: Vec::new(),
        },
    );
}

fn should_emit_workspace_index_state(task_status: &str, state: &WorkspaceIndexState) -> bool {
    task_status == "ready"
        && matches!(
            state.status,
            WorkspaceIndexStatus::Ready | WorkspaceIndexStatus::Empty
        )
}

pub(crate) fn emit_workspace_index_task_statuses(
    app_handle: &AppHandle,
    statuses: &[WorkspaceIndexTaskStatus],
) {
    for status in statuses {
        let _ = app_handle.emit("workspace-index-task-updated", status);
    }
}

pub(crate) fn emit_workspace_index_events(app_handle: &AppHandle, events: &[WorkspaceIndexEvent]) {
    for event in events {
        let _ = app_handle.emit("workspace-index-event", event);
    }
}

#[cfg(test)]
mod tests {
    use super::should_emit_workspace_index_state;
    use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus};

    #[test]
    fn emits_only_terminal_workspace_state_from_ready_task_notifications() {
        assert!(should_emit_workspace_index_state(
            "ready",
            &state(WorkspaceIndexStatus::Ready)
        ));
        assert!(should_emit_workspace_index_state(
            "ready",
            &state(WorkspaceIndexStatus::Empty)
        ));
        assert!(!should_emit_workspace_index_state(
            "ready",
            &state(WorkspaceIndexStatus::Partial)
        ));
        assert!(!should_emit_workspace_index_state(
            "partial",
            &state(WorkspaceIndexStatus::Ready)
        ));
    }

    fn state(status: WorkspaceIndexStatus) -> WorkspaceIndexState {
        WorkspaceIndexState {
            status,
            root_path: Some("/workspace".to_string()),
            file_paths: Vec::new(),
            symbols: Vec::new(),
            indexed_at: Some(1),
            partial_reason: None,
        }
    }
}
