use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTaskStatus};
use crate::services::workspace_index_maintenance_service::clear_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime;
use crate::services::workspace_open_command_service::start_workspace_index_worker;

pub fn rebuild_workspace_index_through_manager(
    index_runtime: &WorkspaceIndexRuntime,
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
) -> Result<(), String> {
    index_manager.with_workspace_maintenance(root_path, || {
        clear_workspace_index(index_runtime, root_path)
    })?;
    index_manager.refresh_workspace_index(root_path)
}

pub fn rebuild_workspace_index_and_start_worker<F>(
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
    root_path: &str,
    on_status: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>) + Send + 'static,
{
    rebuild_workspace_index_through_manager(&index_runtime, &index_manager, root_path)?;
    start_workspace_index_worker(index_runtime, index_manager, ui_activity, on_status)
}
