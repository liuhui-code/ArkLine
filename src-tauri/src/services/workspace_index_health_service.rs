use crate::models::workspace::WorkspaceIndexHealth;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_repair_action_service::{
    workspace_index_health_status, workspace_index_repair_actions, WorkspaceIndexRepairActionInput,
};
use crate::services::workspace_index_resume_service::load_resume_tasks;

pub fn get_workspace_index_health(
    root_path: &str,
    index_manager: &WorkspaceIndexManagerRuntime,
) -> Result<WorkspaceIndexHealth, String> {
    let diagnostics = inspect_workspace_index(root_path)?;
    let queue_pressure = index_manager.get_queue_pressure(root_path)?;
    let status = workspace_index_health_status(&diagnostics.status, diagnostics.sdk_symbol_count);
    let status = workspace_index_health_status_with_queue(status, &queue_pressure);
    let has_resume_tasks = !load_resume_tasks(root_path)?.is_empty();
    let schema_needs_rebuild = diagnostics
        .schema_version_actions
        .iter()
        .any(|action| action.status == "needs-rebuild");
    let repair_actions = workspace_index_repair_actions(&WorkspaceIndexRepairActionInput {
        status: status.to_string(),
        unresolved_import_count: diagnostics.unresolved_import_count,
        parser_error_count: diagnostics.parser_error_count,
        has_active_sdk: diagnostics.active_sdk_path.is_some(),
        has_resume_tasks,
        schema_needs_rebuild,
    });

    Ok(WorkspaceIndexHealth {
        root_path: diagnostics.root_path,
        status: status.to_string(),
        file_count: diagnostics.file_count,
        symbol_count: diagnostics.symbol_count,
        reference_count: diagnostics.stub_declaration_count,
        sdk_api_count: diagnostics.sdk_symbol_count,
        discovery_status: diagnostics.discovery_status,
        discovered_file_count: diagnostics.discovered_file_count,
        unresolved_import_count: diagnostics.unresolved_import_count,
        parser_failure_count: diagnostics.parser_error_count,
        queue_pressure,
        repair_actions,
    })
}

fn workspace_index_health_status_with_queue<'a>(
    status: &'a str,
    queue_pressure: &crate::models::workspace::WorkspaceIndexQueuePressure,
) -> &'a str {
    if status != "healthy" && queue_pressure.workspace_pending_task_count > 0 {
        return "queued";
    }
    status
}
