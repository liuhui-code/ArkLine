use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceIndexState,
    WorkspaceIndexStatus, WorkspaceSearchCandidate, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_entity_query_service::{
    query_workspace_entities, query_workspace_file_symbols, WorkspaceEntityQueryScope,
};
use crate::services::workspace_index_readiness_service::readiness_for_query;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexQueryScope {
    All,
    Files,
    Classes,
    Symbols,
    Apis,
}

pub fn query_workspace_quick_open(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let candidates =
        query_workspace_entities(root_path, query, WorkspaceEntityQueryScope::Files, limit)?;
    if candidates.is_empty() {
        return index_runtime.query_quick_open(root_path, query, limit);
    }
    Ok(candidates)
}

pub fn query_workspace_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_candidates(
        index_runtime,
        root_path,
        query,
        WorkspaceIndexQueryScope::All,
        limit,
    )
}

pub fn query_workspace_candidates(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let entity_scope = match scope {
        WorkspaceIndexQueryScope::All => WorkspaceEntityQueryScope::All,
        WorkspaceIndexQueryScope::Files => WorkspaceEntityQueryScope::Files,
        WorkspaceIndexQueryScope::Classes => WorkspaceEntityQueryScope::Classes,
        WorkspaceIndexQueryScope::Symbols => WorkspaceEntityQueryScope::Symbols,
        WorkspaceIndexQueryScope::Apis => WorkspaceEntityQueryScope::Apis,
    };
    let candidates = query_workspace_entities(root_path, query, entity_scope, limit)?;
    if candidates.is_empty() && scope == WorkspaceIndexQueryScope::All {
        return index_runtime.query_search_everywhere(root_path, query, limit);
    }
    Ok(candidates)
}

pub fn query_workspace_candidates_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let items = query_workspace_candidates(index_runtime, root_path, query, scope, limit)?;
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope { items, readiness })
}

pub fn query_workspace_file_symbols_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let items = query_workspace_file_symbols(root_path, file_path, query, limit)?;
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope { items, readiness })
}

pub fn search_workspace_text(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    if should_use_indexed_text_search(&request) {
        return search_indexed_workspace_content(&request);
    }

    let index_state = index_runtime.get_index_state(&request.root_path)?;
    Ok(search_filesystem_text(&request, &index_state.file_paths))
}

fn readiness_for_index_state(state: &WorkspaceIndexState) -> WorkspaceIndexReadiness {
    let root_path = state.root_path.as_deref().unwrap_or_default();
    let served_generation = state.indexed_at.and_then(|value| u64::try_from(value).ok());
    let requested_generation = match state.status {
        WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => {
            served_generation.unwrap_or_default().saturating_add(1)
        }
        _ => served_generation.unwrap_or_default(),
    };
    let partial_reason = match state.status {
        WorkspaceIndexStatus::Partial => state.partial_reason.as_deref().or(Some("Index is partial")),
        _ => None,
    };
    readiness_for_query(root_path, requested_generation, served_generation, partial_reason)
}

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/') && !request.options.whole_word
}
