use crate::models::language::{DefinitionCandidate, DefinitionTarget, LanguageQueryRequest};
use crate::services::workspace_index_facade_explain_service::explain_facade_query;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};
use crate::services::workspace_index_query_service::query_definition_candidates_with_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_reference_index_service::query_reference_at_position;
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

pub fn query_facade_definition(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    semantic_target: Option<DefinitionTarget>,
    semantic_candidates: Vec<DefinitionCandidate>,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let confidence = confidence_at_position(root_path, request)?;
    let envelope = query_definition_candidates_with_readiness(
        index_runtime,
        root_path,
        request,
        semantic_target,
        semantic_candidates,
    )?;
    let explain = explain_facade_query(
        "definition",
        &envelope.readiness,
        envelope.items.len(),
        confidence.as_deref(),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Definition)
            .collect(),
        readiness: envelope.readiness,
        confidence,
        explain,
    })
}

pub fn query_facade_usages(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let confidence = confidence_at_position(root_path, request)?;
    let envelope = query_usages_with_readiness(index_runtime, root_path, request, limit)?;
    let explain = explain_facade_query(
        "usages",
        &envelope.readiness,
        envelope.items.len(),
        confidence.as_deref(),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Usage)
            .collect(),
        readiness: envelope.readiness,
        confidence,
        explain,
    })
}

fn confidence_at_position(
    root_path: &str,
    request: &LanguageQueryRequest,
) -> Result<Option<String>, String> {
    Ok(
        query_reference_at_position(root_path, &request.path, request.line, request.column)?
            .map(|reference| reference.confidence),
    )
}
