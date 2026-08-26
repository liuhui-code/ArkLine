use std::time::Instant;

use tauri::{AppHandle, State};

use crate::models::language::{
    CallHierarchyResult, CompletionItem, DefinitionCandidate, LanguageQueryBrokerEnvelope,
    LanguageQueryRequest, RenameImpactResult, TypeHierarchyResult, UsageResult,
};
use crate::models::workspace::WorkspaceIndexQueryEnvelope;
use crate::services::language_command_service::{
    complete_symbol_with_document_version_blocking,
    goto_definition_candidates_with_document_version_blocking,
};
use crate::services::language_query_broker_service::deadline::{
    await_semantic_until, completion_semantic_budget, definition_semantic_budget, elapsed_millis,
    SemanticDeadlineOutcome,
};
use crate::services::language_query_broker_service::{
    assemble_language_completion, assemble_language_definition,
};
use crate::services::language_service::LanguageRuntime;
use crate::services::workspace_index_facade_completion_service::query_facade_completion;
use crate::services::workspace_index_facade_navigation_service::query_facade_definition;
use crate::services::workspace_index_facade_service::{
    query_facade_completions_with_readiness as query_semantic_completions_with_readiness_service,
    query_facade_definition_candidates_with_readiness as query_definition_candidates_with_readiness_service,
    query_facade_usages_with_readiness as query_usages_with_readiness_service,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_rename_impact_service::query_rename_impact as query_rename_impact_service;
use crate::services::workspace_symbol_hierarchy_service::{
    query_call_hierarchy as query_call_hierarchy_service,
    query_type_hierarchy as query_type_hierarchy_service,
};

#[tauri::command]
pub fn query_definition_candidates_with_readiness(
    root_path: String,
    request: LanguageQueryRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    // Language-service fallback runs through its dedicated blocking command after an index miss.
    query_definition_candidates_with_readiness_service(
        &index_runtime,
        &root_path,
        &request,
        None,
        Vec::new(),
    )
}

#[tauri::command]
pub fn query_usages_with_readiness(
    root_path: String,
    request: LanguageQueryRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<UsageResult>, String> {
    query_usages_with_readiness_service(&index_runtime, &root_path, &request, 500)
}

#[tauri::command]
pub fn query_rename_impact(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<RenameImpactResult>, String> {
    query_rename_impact_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn query_call_hierarchy(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<CallHierarchyResult>, String> {
    query_call_hierarchy_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn query_type_hierarchy(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<TypeHierarchyResult>, String> {
    query_type_hierarchy_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn semantic_complete_symbol(
    root_path: String,
    request: LanguageQueryRequest,
    request_generation: Option<u64>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<CompletionItem>, String> {
    let mut envelope = query_semantic_completions_with_readiness_service(
        &index_runtime,
        &root_path,
        &request,
        100,
    )?;
    if let Some(generation) = request_generation {
        envelope
            .explain
            .push(format!("requestGeneration:{generation}"));
    }
    Ok(envelope)
}

#[tauri::command]
pub async fn query_language_definition(
    app: AppHandle,
    root_path: String,
    request: LanguageQueryRequest,
    request_generation: u64,
    document_version: Option<u64>,
    language_runtime: State<'_, LanguageRuntime>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<LanguageQueryBrokerEnvelope<DefinitionCandidate>, String> {
    let started_at = Instant::now();
    let semantic_runtime = language_runtime.inner().clone();
    let semantic_request = request.clone();
    let semantic_task = tauri::async_runtime::spawn(async move {
        goto_definition_candidates_with_document_version_blocking(
            app,
            semantic_runtime,
            semantic_request,
            document_version,
        )
        .await
    });
    let index_runtime_snapshot = index_runtime.inner().clone();
    let index_root_path = root_path.clone();
    let index_request = request.clone();
    let index_task = tauri::async_runtime::spawn_blocking(move || {
        query_facade_definition(
            &index_runtime_snapshot,
            &index_root_path,
            &index_request,
            None,
            Vec::new(),
        )
    });
    let mut facade = index_task.await.map_err(|error| error.to_string())??;
    let index_ms = elapsed_millis(started_at);
    let semantic_budget = definition_semantic_budget(!facade.items.is_empty());
    let semantic_outcome = await_semantic_until(semantic_task, started_at, semantic_budget).await;
    let (semantic_candidates, semantic_error, semantic_state, semantic_pending) =
        match semantic_outcome {
            SemanticDeadlineOutcome::Ready(items) => {
                let error = items
                    .is_empty()
                    .then(|| semantic_runtime_error(&language_runtime))
                    .flatten();
                (items, error, "ready", false)
            }
            SemanticDeadlineOutcome::Failed(error) => (Vec::new(), Some(error), "failed", false),
            SemanticDeadlineOutcome::TimedOut => (
                Vec::new(),
                Some(format!(
                    "Semantic definition exceeded the {}ms foreground budget",
                    semantic_budget.as_millis()
                )),
                "deadline",
                true,
            ),
        };
    append_broker_timing(&mut facade.explain, index_ms, semantic_state, started_at);
    Ok(assemble_language_definition(
        request_generation,
        document_version,
        semantic_candidates,
        semantic_error,
        semantic_pending,
        facade,
    ))
}

#[tauri::command]
pub async fn query_language_completion(
    app: AppHandle,
    root_path: String,
    request: LanguageQueryRequest,
    request_generation: u64,
    document_version: Option<u64>,
    language_runtime: State<'_, LanguageRuntime>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<LanguageQueryBrokerEnvelope<CompletionItem>, String> {
    let started_at = Instant::now();
    let index_runtime_snapshot = index_runtime.inner().clone();
    let index_root_path = root_path.clone();
    let index_request = request.clone();
    let index_task = tauri::async_runtime::spawn_blocking(move || {
        query_facade_completion(
            &index_runtime_snapshot,
            &index_root_path,
            &index_request,
            100,
        )
    });
    let semantic_runtime = language_runtime.inner().clone();
    let semantic_request = request.clone();
    let semantic_task = tauri::async_runtime::spawn(async move {
        complete_symbol_with_document_version_blocking(
            app,
            semantic_runtime,
            semantic_request,
            document_version,
        )
        .await
    });
    let mut facade = index_task.await.map_err(|error| error.to_string())??;
    let index_ms = elapsed_millis(started_at);
    let semantic_budget = completion_semantic_budget(!facade.items.is_empty());
    let semantic_outcome = await_semantic_until(semantic_task, started_at, semantic_budget).await;
    let (language_items, semantic_error, semantic_state) = match semantic_outcome {
        SemanticDeadlineOutcome::Ready(items) => {
            let error = items
                .is_empty()
                .then(|| semantic_runtime_error(&language_runtime))
                .flatten();
            (items, error, "ready")
        }
        SemanticDeadlineOutcome::Failed(error) => (Vec::new(), Some(error), "failed"),
        SemanticDeadlineOutcome::TimedOut => (
            Vec::new(),
            Some(format!(
                "Semantic completion exceeded the {}ms foreground budget",
                semantic_budget.as_millis()
            )),
            "deadline",
        ),
    };
    append_broker_timing(&mut facade.explain, index_ms, semantic_state, started_at);
    Ok(assemble_language_completion(
        &request,
        request_generation,
        document_version,
        language_items,
        semantic_error,
        facade,
    ))
}

fn append_broker_timing(
    explain: &mut Vec<String>,
    index_ms: u128,
    semantic_state: &str,
    started_at: Instant,
) {
    explain.push(format!("broker:indexMs:{index_ms}"));
    explain.push(format!("broker:semanticState:{semantic_state}"));
    explain.push(format!("broker:elapsedMs:{}", elapsed_millis(started_at)));
}

fn semantic_runtime_error(runtime: &LanguageRuntime) -> Option<String> {
    let report = runtime.inspect_current();
    report
        .supervisor
        .and_then(|snapshot| snapshot.last_error)
        .or_else(|| {
            (report.mode != "semantic")
                .then(|| format!("Semantic provider is {}: {}", report.mode, report.detail))
        })
}
