use crate::models::workspace::{WorkspaceIndexExplainRequest, WorkspaceIndexExplainResult};
use crate::services::workspace_index_explain_service::explain_workspace_index_query as explain_workspace_index_query_service;

#[tauri::command]
pub fn explain_workspace_index_query(
    request: WorkspaceIndexExplainRequest,
) -> Result<WorkspaceIndexExplainResult, String> {
    explain_workspace_index_query_service(&request)
}
