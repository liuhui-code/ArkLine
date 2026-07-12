use crate::services::workspace_index_maintenance_service::clear_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

pub fn rebuild_workspace_index_through_manager(
    index_runtime: &WorkspaceIndexRuntime,
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
) -> Result<(), String> {
    clear_workspace_index(index_runtime, root_path)?;
    index_manager.refresh_workspace_index(root_path)
}
