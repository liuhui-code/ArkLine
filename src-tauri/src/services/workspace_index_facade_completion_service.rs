use crate::models::language::LanguageQueryRequest;
use crate::models::workspace_index_layer::{
    WorkspaceIndexLayerReadiness, WorkspaceIndexLayerStatus,
};
use crate::services::workspace_completion_semantic_service::query_semantic_completions_with_readiness;
use crate::services::workspace_index_facade_explain_service::explain_facade_query;
use crate::services::workspace_index_facade_readiness_gate_service::gate_current_file_catalog;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

pub fn query_facade_completion(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let mut envelope =
        query_semantic_completions_with_readiness(index_runtime, root_path, request, limit)?;
    let extra_explain =
        gate_current_file_catalog(root_path, &request.path, &mut envelope.readiness)?;
    let mut explain = explain_facade_query(
        "completion",
        &envelope.readiness,
        envelope.items.len(),
        Some("semantic"),
    );
    explain.extend(extra_explain);
    append_layer_explain(root_path, &mut explain)?;
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Completion)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("semantic".to_string()),
        explain,
    })
}

fn append_layer_explain(root_path: &str, explain: &mut Vec<String>) -> Result<(), String> {
    let report = get_workspace_index_layer_readiness(root_path, None)?;
    push_layer_status(&report.layers, "projectFile", explain);
    push_layer_status(&report.layers, "sdkApi", explain);
    Ok(())
}

fn push_layer_status(
    layers: &[WorkspaceIndexLayerReadiness],
    name: &str,
    explain: &mut Vec<String>,
) {
    let status = layers
        .iter()
        .find(|layer| layer.layer == name)
        .map(|layer| layer_status_label(&layer.workspace_status))
        .unwrap_or("missing");
    explain.push(format!("layer:{name}:{status}"));
}

fn layer_status_label(status: &WorkspaceIndexLayerStatus) -> &'static str {
    match status {
        WorkspaceIndexLayerStatus::Ready => "ready",
        WorkspaceIndexLayerStatus::Partial => "partial",
        WorkspaceIndexLayerStatus::Stale => "stale",
        WorkspaceIndexLayerStatus::Failed => "failed",
        WorkspaceIndexLayerStatus::Missing => "missing",
    }
}
