use crate::models::workspace::{WorkspaceTextSearchRequest, WorkspaceTextSearchResult};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_facade_explain_service::explain_facade_query;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};
use crate::services::workspace_index_query_service::{
    query_workspace_candidates_with_readiness, query_workspace_file_symbols_with_readiness,
    WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;

pub fn query_facade_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let envelope =
        query_workspace_candidates_with_readiness(index_runtime, root_path, query, scope, limit)?;
    let explain = explain_facade_query(
        "searchEverywhere",
        &envelope.readiness,
        envelope.items.len(),
        Some("indexed"),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain,
    })
}

pub fn query_facade_file_symbols(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let envelope = query_workspace_file_symbols_with_readiness(
        index_runtime,
        root_path,
        file_path,
        query,
        limit,
    )?;
    let explain = explain_facade_query(
        "fileSymbols",
        &envelope.readiness,
        envelope.items.len(),
        Some("indexed"),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain,
    })
}

pub fn query_facade_text_search(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let readiness = crate::services::workspace_index_query_service::readiness_for_index_state(
        &index_runtime.get_index_state(&request.root_path)?,
    );
    let result = raw_text_search_result(index_runtime, request)?;
    let explain = explain_facade_query("textSearch", &readiness, 1, Some("indexed"));
    Ok(WorkspaceIndexFacadeEnvelope {
        items: vec![WorkspaceIndexFacadeItem::TextSearch(result)],
        readiness,
        confidence: Some("indexed".to_string()),
        explain,
    })
}

fn raw_text_search_result(
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
