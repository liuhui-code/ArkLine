use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, State};

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, SemanticDocumentCloseRequest,
    SemanticDocumentPrepareRequest, SemanticDocumentSyncRequest, SignatureHelp, UsageQueryResult,
};
use crate::services::language_client_runtime_service::{
    run_language_request, LanguageClientRequest, LanguageClientSource,
};
use crate::services::language_command_service::{
    close_document_blocking, complete_symbol_with_document_version_blocking,
    document_symbols_blocking, find_usages_blocking, goto_definition_blocking,
    goto_definition_candidates_blocking, hover_symbol_blocking, inspect_language_service_blocking,
    prepare_document_blocking, resolve_completion_blocking, signature_help_blocking,
    sync_document_blocking,
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
        language_request(LanguageClientSource::Hover, None),
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
        language_request(LanguageClientSource::Definition, None),
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
        language_request(LanguageClientSource::DefinitionCandidates, None),
        goto_definition_candidates_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn complete_symbol(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
    request_generation: Option<u64>,
    document_version: Option<u64>,
) -> Result<Vec<CompletionItem>, String> {
    run_language_request(
        language_request(LanguageClientSource::Completion, request_generation),
        complete_symbol_with_document_version_blocking(
            app,
            runtime.inner().clone(),
            request,
            document_version,
        ),
    )
    .await
}

#[tauri::command]
pub async fn resolve_completion(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
    item: CompletionItem,
    document_version: Option<u64>,
) -> Result<CompletionItem, String> {
    run_language_request(
        language_request(LanguageClientSource::CompletionResolve, None),
        resolve_completion_blocking(
            app,
            runtime.inner().clone(),
            request,
            item,
            document_version,
        ),
    )
    .await
}

#[tauri::command]
pub async fn signature_help(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<SignatureHelp>, String> {
    run_language_request(
        language_request(LanguageClientSource::SignatureHelp, None),
        signature_help_blocking(app, runtime.inner().clone(), request),
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
        language_request(LanguageClientSource::DocumentSymbols, None),
        document_symbols_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn find_usages(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<UsageQueryResult, String> {
    run_language_request(
        language_request(LanguageClientSource::Usages, None),
        find_usages_blocking(app, runtime.inner().clone(), request),
    )
    .await
}

#[tauri::command]
pub async fn sync_language_document(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: SemanticDocumentSyncRequest,
) -> Result<(), String> {
    sync_document_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn close_language_document(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: SemanticDocumentCloseRequest,
) -> Result<(), String> {
    close_document_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn prepare_language_document(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: SemanticDocumentPrepareRequest,
) -> Result<(), String> {
    prepare_document_blocking(app, runtime.inner().clone(), request).await
}

fn language_request(
    source: LanguageClientSource,
    requested_generation: Option<u64>,
) -> LanguageClientRequest {
    let request_id = LANGUAGE_COMMAND_REQUEST_ID.fetch_add(1, Ordering::Relaxed) + 1;
    LanguageClientRequest::new(
        source,
        request_id,
        requested_generation.unwrap_or(request_id),
        LANGUAGE_COMMAND_TIMEOUT_MS,
    )
}
