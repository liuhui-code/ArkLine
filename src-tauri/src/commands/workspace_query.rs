use tauri::State;

use crate::models::workspace::{WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_query_broker_service::WorkspaceQueryBrokerRuntime;
use crate::services::workspace_query_command_service::{
    query_workspace_candidates_brokered_blocking, query_workspace_file_symbols_facade_blocking,
    query_workspace_quick_open_blocking, query_workspace_search_everywhere_compat_blocking,
};
use crate::services::workspace_search_ranking_service::WorkspaceSearchRankingContext;

#[tauri::command]
pub async fn query_workspace_quick_open(
    root_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_quick_open_blocking(index_runtime.inner().clone(), root_path, query, limit)
        .await
}

#[tauri::command]
pub async fn query_workspace_search_everywhere(
    root_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_search_everywhere_compat_blocking(
        index_runtime.inner().clone(),
        root_path,
        query,
        limit,
    )
    .await
}

#[tauri::command]
pub async fn query_workspace_candidates(
    root_path: String,
    query: String,
    scope: String,
    limit: usize,
    cursor: Option<usize>,
    context: Option<WorkspaceSearchRankingContext>,
    generation: Option<u64>,
    deadline_ms: Option<u64>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    query_broker: State<'_, WorkspaceQueryBrokerRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    Ok(query_workspace_candidates_brokered_blocking(
        index_runtime.inner().clone(),
        query_broker.inner().clone(),
        root_path,
        query,
        parse_index_query_scope(&scope)?,
        limit,
        cursor,
        context.unwrap_or_default(),
        generation,
        deadline_ms,
    )
    .await?
    .items)
}

#[tauri::command]
pub async fn query_workspace_candidates_with_readiness(
    root_path: String,
    query: String,
    scope: String,
    limit: usize,
    cursor: Option<usize>,
    context: Option<WorkspaceSearchRankingContext>,
    generation: Option<u64>,
    deadline_ms: Option<u64>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    query_broker: State<'_, WorkspaceQueryBrokerRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_candidates_brokered_blocking(
        index_runtime.inner().clone(),
        query_broker.inner().clone(),
        root_path,
        query,
        parse_index_query_scope(&scope)?,
        limit,
        cursor,
        context.unwrap_or_default(),
        generation,
        deadline_ms,
    )
    .await
}

#[tauri::command]
pub async fn query_workspace_file_symbols(
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    cursor: Option<usize>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    Ok(query_workspace_file_symbols_facade_blocking(
        index_runtime.inner().clone(),
        root_path,
        file_path,
        query,
        limit,
        cursor,
    )
    .await?
    .items)
}

#[tauri::command]
pub async fn query_workspace_file_symbols_with_readiness(
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    cursor: Option<usize>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_file_symbols_facade_blocking(
        index_runtime.inner().clone(),
        root_path,
        file_path,
        query,
        limit,
        cursor,
    )
    .await
}

fn parse_index_query_scope(scope: &str) -> Result<WorkspaceIndexQueryScope, String> {
    match scope {
        "all" => Ok(WorkspaceIndexQueryScope::All),
        "files" => Ok(WorkspaceIndexQueryScope::Files),
        "classes" => Ok(WorkspaceIndexQueryScope::Classes),
        "symbols" => Ok(WorkspaceIndexQueryScope::Symbols),
        "api" => Ok(WorkspaceIndexQueryScope::Apis),
        "text" => Ok(WorkspaceIndexQueryScope::Text),
        value => Err(format!("Unsupported workspace index query scope: {value}")),
    }
}
