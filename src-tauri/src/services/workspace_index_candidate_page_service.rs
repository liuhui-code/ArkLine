use crate::models::workspace::{WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate};
use crate::services::workspace_index_entity_query_service::query_workspace_file_symbols;
use crate::services::workspace_index_query_service::{
    query_workspace_candidates, readiness_for_index_state, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

const MAX_CANDIDATE_PAGE_LIMIT: usize = 100;

pub fn query_workspace_candidate_page(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let limit = normalize_candidate_page_limit(limit);
    let offset = cursor.unwrap_or_default();
    let fetch_limit = offset.saturating_add(limit).saturating_add(1);
    let candidates =
        query_workspace_candidates(index_runtime, root_path, query, scope, fetch_limit)?;
    let has_more = candidates.len() > offset.saturating_add(limit);
    let items = candidates.into_iter().skip(offset).take(limit).collect();
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(),
        next_cursor: has_more.then_some(offset.saturating_add(limit)),
    })
}

pub fn query_workspace_file_symbol_page(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let limit = normalize_candidate_page_limit(limit);
    let offset = cursor.unwrap_or_default();
    let fetch_limit = offset.saturating_add(limit).saturating_add(1);
    let candidates = query_workspace_file_symbols(root_path, file_path, query, fetch_limit)?;
    let has_more = candidates.len() > offset.saturating_add(limit);
    let items = candidates.into_iter().skip(offset).take(limit).collect();
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(),
        next_cursor: has_more.then_some(offset.saturating_add(limit)),
    })
}

pub(crate) fn normalize_candidate_page_limit(limit: usize) -> usize {
    limit.clamp(1, MAX_CANDIDATE_PAGE_LIMIT)
}
