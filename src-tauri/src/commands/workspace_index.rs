use crate::models::workspace::{
    WorkspaceIndexExplainRequest, WorkspaceIndexExplainResult, WorkspaceIndexFileReadiness,
};
use crate::models::workspace_index_layer::WorkspaceIndexLayerReadinessReport;
use crate::services::workspace_index_explain_service::explain_and_record_workspace_index_query as explain_workspace_index_query_service;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness as get_workspace_index_file_readiness_service;
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness as get_workspace_index_layer_readiness_service;

#[tauri::command]
pub fn explain_workspace_index_query(
    request: WorkspaceIndexExplainRequest,
) -> Result<WorkspaceIndexExplainResult, String> {
    explain_workspace_index_query_service(&request)
}

#[tauri::command]
pub fn get_workspace_index_file_readiness(
    root_path: String,
    file_path: String,
) -> Result<WorkspaceIndexFileReadiness, String> {
    get_workspace_index_file_readiness_service(&root_path, &file_path)
}

#[tauri::command]
pub fn get_workspace_index_layer_readiness(
    root_path: String,
    current_file_path: Option<String>,
) -> Result<WorkspaceIndexLayerReadinessReport, String> {
    get_workspace_index_layer_readiness_service(&root_path, current_file_path.as_deref())
}
