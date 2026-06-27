use crate::models::workspace::{
    WorkspaceSearchCandidate, WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;

pub fn query_workspace_quick_open(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    index_runtime.query_quick_open(root_path, query, limit)
}

pub fn query_workspace_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    index_runtime.query_search_everywhere(root_path, query, limit)
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

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/') && !request.options.whole_word
}
