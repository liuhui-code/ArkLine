use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, State};

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, UsageResult,
};
use crate::services::language_client_runtime_service::{
    run_language_request, LanguageClientRequest, LanguageClientSource,
};
use crate::services::language_command_service::{
    complete_symbol_blocking, document_symbols_blocking, find_usages_blocking,
    goto_definition_blocking, goto_definition_candidates_blocking, hover_symbol_blocking,
    inspect_language_service_blocking,
};
use crate::services::language_service::LanguageRuntime;

const LANGUAGE_COMMAND_TIMEOUT_MS: u64 = 3500;
static LANGUAGE_COMMAND_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub async fn inspect_language_service(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
) -> Result<LanguageServiceReport, String> {
    inspect_language_service_blocking(app, runtime.inner().clone()).await
}

#[tauri::command]
pub async fn hover_symbol(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<HoverResponse>, String> {
    run_language_request(
        language_request(LanguageClientSource::Hover),
        hover_symbol_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn goto_definition(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<DefinitionTarget>, String> {
    run_language_request(
        language_request(LanguageClientSource::Definition),
        goto_definition_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn goto_definition_candidates(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    run_language_request(
        language_request(LanguageClientSource::DefinitionCandidates),
        goto_definition_candidates_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn complete_symbol(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<CompletionItem>, String> {
    run_language_request(
        language_request(LanguageClientSource::Completion),
        complete_symbol_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn document_symbols(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DocumentSymbol>, String> {
    run_language_request(
        language_request(LanguageClientSource::DocumentSymbols),
        document_symbols_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn find_usages(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<UsageResult>, String> {
    run_language_request(
        language_request(LanguageClientSource::Usages),
        find_usages_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

fn language_request(source: LanguageClientSource) -> LanguageClientRequest {
    let request_id = LANGUAGE_COMMAND_REQUEST_ID.fetch_add(1, Ordering::Relaxed) + 1;
    LanguageClientRequest::new(source, request_id, request_id, LANGUAGE_COMMAND_TIMEOUT_MS)
}
