use tauri::async_runtime::spawn_blocking;

use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::workspace_index_facade_service::{
    query_facade_search_everywhere_with_readiness,
    query_facade_text_search_result_with_cancellation,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};
use crate::services::workspace_search_session_service::WorkspaceSearchSessionRuntime;
use crate::services::workspace_text_search_cancellation_service::WorkspaceTextSearchCancellationRuntime;

pub async fn query_workspace_candidates_blocking(
    index_runtime: WorkspaceIndexRuntime,
    root_path: String,
    query: String,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    spawn_blocking(move || {
        query_facade_search_everywhere_with_readiness(
            &index_runtime,
            &root_path,
            &query,
            scope,
            limit,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn search_workspace_text_blocking(
    index_runtime: WorkspaceIndexRuntime,
    text_search_cancellation: WorkspaceTextSearchCancellationRuntime,
    search_session: WorkspaceSearchSessionRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    let root_path = request.root_path.clone();
    let generation = request.generation;
    ui_activity.record_ui_activity(
        WorkspaceIndexUiActivityKind::SearchInput,
        current_time_millis() as u64,
    )?;
    if let Some(generation) = generation {
        text_search_cancellation.register_generation(&root_path, generation)?;
        search_session.register_generation(&root_path, "text", generation)?;
    }

    spawn_blocking(move || {
        query_facade_text_search_result_with_cancellation(&index_runtime, request, move || {
            generation
                .map(|value| {
                    text_search_cancellation
                        .is_generation_stale(&root_path, value)
                        .unwrap_or(false)
                        || search_session
                            .is_generation_stale(&root_path, "text", value)
                            .unwrap_or(false)
                })
                .unwrap_or(false)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
