use crate::models::workspace::{WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate};
use crate::services::workspace_index_query_service::{
    query_workspace_candidates, readiness_for_index_state, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

pub fn query_workspace_candidate_page(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let offset = cursor.unwrap_or_default();
    let fetch_limit = offset.saturating_add(limit).saturating_add(1);
    let candidates = query_workspace_candidates(index_runtime, root_path, query, scope, fetch_limit)?;
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
