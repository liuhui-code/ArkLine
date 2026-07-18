use crate::models::language::{DefinitionCandidate, DefinitionTarget, LanguageQueryRequest};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceIndexState,
    WorkspaceIndexStatus, WorkspaceSearchCandidate, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_definition_candidate_query_service::query_index_definition_candidates;
use crate::services::workspace_index_entity_query_service::{
    query_workspace_entities_with_file_index, WorkspaceEntityQueryScope,
};
use crate::services::workspace_index_query_path_service::normalize_candidate_paths_for_filesystem;
use crate::services::workspace_index_readiness_service::readiness_for_query;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_text_candidate_service::text_search_candidates;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexQueryScope {
    All,
    Files,
    Classes,
    Symbols,
    Apis,
    Text,
}

pub fn query_workspace_quick_open(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let mut candidates = query_workspace_entities_with_file_index(
        index_runtime,
        root_path,
        query,
        WorkspaceEntityQueryScope::Files,
        limit,
    )?;
    if candidates.is_empty() {
        candidates = index_runtime.query_quick_open(root_path, query, limit)?;
    }
    normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
    Ok(candidates)
}

#[allow(dead_code)]
// Raw timing baseline for interaction perf fixtures; product query paths use the facade.
pub(crate) fn query_workspace_search_everywhere_raw_baseline(
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

pub(crate) fn query_workspace_candidates(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    if scope == WorkspaceIndexQueryScope::Text {
        return text_search_candidates(index_runtime, root_path, query, limit);
    }
    let entity_scope = match scope {
        WorkspaceIndexQueryScope::All => WorkspaceEntityQueryScope::All,
        WorkspaceIndexQueryScope::Files => WorkspaceEntityQueryScope::Files,
        WorkspaceIndexQueryScope::Classes => WorkspaceEntityQueryScope::Classes,
        WorkspaceIndexQueryScope::Symbols => WorkspaceEntityQueryScope::Symbols,
        WorkspaceIndexQueryScope::Apis => WorkspaceEntityQueryScope::Apis,
        WorkspaceIndexQueryScope::Text => unreachable!("text scope is handled above"),
    };
    let mut candidates = query_workspace_entities_with_file_index(
        index_runtime,
        root_path,
        query,
        entity_scope,
        limit,
    )?;
    if candidates.is_empty() && scope == WorkspaceIndexQueryScope::All {
        candidates = index_runtime.query_search_everywhere(root_path, query, limit)?;
        normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
        return Ok(candidates);
    }
    crate::services::workspace_search_ranking_service::sort_search_everywhere_candidates(
        &mut candidates,
        limit,
    );
    normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
    Ok(candidates)
}

pub fn query_definition_candidates_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    semantic_target: Option<DefinitionTarget>,
    semantic_candidates: Vec<DefinitionCandidate>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    let mut items = Vec::new();
    if let Some(target) = semantic_target {
        items.push(candidate_from_target(target, "Language service definition"));
    }
    items.extend(semantic_candidates);
    if items.is_empty() {
        items.extend(query_index_definition_candidates(root_path, request)?);
    }
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(),
        next_cursor: None,
    })
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

pub(crate) fn readiness_for_index_state(state: &WorkspaceIndexState) -> WorkspaceIndexReadiness {
    let root_path = state.root_path.as_deref().unwrap_or_default();
    let served_generation = state.indexed_at.and_then(|value| u64::try_from(value).ok());
    let requested_generation = match state.status {
        WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => {
            served_generation.unwrap_or_default().saturating_add(1)
        }
        _ => served_generation.unwrap_or_default(),
    };
    let partial_reason = match state.status {
        WorkspaceIndexStatus::Partial => {
            state.partial_reason.as_deref().or(Some("Index is partial"))
        }
        _ => None,
    };
    readiness_for_query(
        root_path,
        requested_generation,
        served_generation,
        partial_reason,
    )
}

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/')
}

fn candidate_from_target(target: DefinitionTarget, preview: &str) -> DefinitionCandidate {
    DefinitionCandidate {
        path: target.path,
        line: target.line,
        column: target.column,
        preview: preview.to_string(),
    }
}
