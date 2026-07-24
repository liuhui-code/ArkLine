use tauri::async_runtime::spawn_blocking;

use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::workspace_index_facade_envelope_service::search_query_envelope;
use crate::services::workspace_index_facade_event_service::record_facade_query_event;
use crate::services::workspace_index_facade_search_service::{
    query_facade_file_symbols_page, query_facade_search_everywhere_page_with_context,
};
use crate::services::workspace_index_facade_service::{
    query_facade_search_everywhere_with_readiness_context,
    query_facade_text_search_result_with_cancellation,
};
use crate::services::workspace_index_query_service::{
    query_workspace_quick_open, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};
use crate::services::workspace_index_writer_actor_service::WorkspaceIndexWriterActor;
use crate::services::workspace_query_broker_service::{
    WorkspaceQueryBrokerRuntime, CONTENT_QUERY_DEADLINE_MS, ENTITY_QUERY_DEADLINE_MS,
};
use crate::services::workspace_search_ranking_service::WorkspaceSearchRankingContext;
use crate::services::workspace_text_search_cancellation_service::WorkspaceTextSearchCancellationRuntime;

pub async fn query_workspace_candidates_facade_blocking(
    index_runtime: WorkspaceIndexRuntime,
    root_path: String,
    query: String,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
    context: WorkspaceSearchRankingContext,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    spawn_blocking(move || {
        if cursor.is_none() {
            return query_facade_search_everywhere_with_readiness_context(
                &index_runtime,
                &root_path,
                &query,
                scope,
                limit,
                &context,
            );
        }
        let envelope = query_facade_search_everywhere_page_with_context(
            &index_runtime,
            &root_path,
            &query,
            scope,
            limit,
            cursor,
            &context,
        )?;
        record_facade_query_event(&root_path, "searchEverywhere", &envelope);
        Ok(search_query_envelope(envelope))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn query_workspace_candidates_brokered_blocking(
    index_runtime: WorkspaceIndexRuntime,
    query_broker: WorkspaceQueryBrokerRuntime,
    root_path: String,
    query: String,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
    context: WorkspaceSearchRankingContext,
    generation: Option<u64>,
    deadline_ms: Option<u64>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let ticket = query_broker.begin(
        &root_path,
        "searchEverywhere",
        generation,
        deadline_ms.unwrap_or(ENTITY_QUERY_DEADLINE_MS),
    )?;
    spawn_blocking(move || {
        ticket.check()?;
        let result = if cursor.is_none() {
            query_facade_search_everywhere_with_readiness_context(
                &index_runtime,
                &root_path,
                &query,
                scope,
                limit,
                &context,
            )
        } else {
            let envelope = query_facade_search_everywhere_page_with_context(
                &index_runtime,
                &root_path,
                &query,
                scope,
                limit,
                cursor,
                &context,
            )?;
            record_facade_query_event(&root_path, "searchEverywhere", &envelope);
            Ok(search_query_envelope(envelope))
        }?;
        ticket.check()?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn query_workspace_quick_open_blocking(
    index_runtime: WorkspaceIndexRuntime,
    root_path: String,
    query: String,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    spawn_blocking(move || query_workspace_quick_open(&index_runtime, &root_path, &query, limit))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn query_workspace_search_everywhere_compat_blocking(
    index_runtime: WorkspaceIndexRuntime,
    root_path: String,
    query: String,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    spawn_blocking(move || {
        query_facade_search_everywhere_with_readiness_context(
            &index_runtime,
            &root_path,
            &query,
            WorkspaceIndexQueryScope::All,
            limit,
            &WorkspaceSearchRankingContext::default(),
        )
        .map(|envelope| envelope.items)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn query_workspace_file_symbols_facade_blocking(
    index_runtime: WorkspaceIndexRuntime,
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    spawn_blocking(move || {
        let envelope = query_facade_file_symbols_page(
            &index_runtime,
            &root_path,
            &file_path,
            &query,
            limit,
            cursor,
        )?;
        record_facade_query_event(&root_path, "fileSymbols", &envelope);
        Ok(search_query_envelope(envelope))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn search_workspace_text_blocking(
    index_runtime: WorkspaceIndexRuntime,
    text_search_cancellation: WorkspaceTextSearchCancellationRuntime,
    query_broker: WorkspaceQueryBrokerRuntime,
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
    }
    let ticket = query_broker.begin(&root_path, "text", generation, CONTENT_QUERY_DEADLINE_MS)?;
    let foreground_read = WorkspaceIndexWriterActor::shared().begin_foreground_read();

    spawn_blocking(move || {
        let _foreground_read = foreground_read;
        let cancellation_ticket = ticket.clone();
        let result = query_facade_text_search_result_with_cancellation(
            &index_runtime,
            request,
            move || {
                cancellation_ticket.should_cancel()
                    || generation
                        .map(|value| {
                            text_search_cancellation
                                .is_generation_stale(&root_path, value)
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
            },
        )?;
        ticket.ensure_current()?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}
