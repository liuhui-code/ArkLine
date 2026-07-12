use tauri::{AppHandle, Emitter};

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTaskStatus};

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
