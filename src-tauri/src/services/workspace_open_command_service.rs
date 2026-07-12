use std::path::PathBuf;

use tauri::async_runtime::spawn_blocking;

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTaskStatus, WorkspaceSnapshot};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime;
use crate::services::workspace_service::scan_workspace_for_open;

pub async fn open_workspace_through_manager_blocking<F>(
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
    root_path: String,
    on_status: F,
) -> Result<WorkspaceSnapshot, String>
where
    F: Fn(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>) + Send + 'static,
{
    spawn_blocking(move || {
        open_workspace_through_manager(
            index_runtime,
            index_manager,
            ui_activity,
            &root_path,
            on_status,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn open_workspace_through_manager<F>(
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
    root_path: &str,
    on_status: F,
) -> Result<WorkspaceSnapshot, String>
where
    F: Fn(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>) + Send + 'static,
{
    let snapshot = scan_workspace_for_open(&PathBuf::from(root_path))?;
    index_manager.open_workspace_index(root_path)?;
    index_manager.start_background_worker_with_events_and_ui_activity(
        index_runtime,
        on_status,
        move || {
            ui_activity
                .is_latency_sensitive(current_time_millis() as u64)
                .unwrap_or(false)
        },
    )?;
    Ok(snapshot)
}
