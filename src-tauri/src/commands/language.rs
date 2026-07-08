use tauri::{AppHandle, State};

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, UsageResult,
};
use crate::services::language_command_service::{
    complete_symbol_blocking, document_symbols_blocking, find_usages_blocking,
    goto_definition_blocking, goto_definition_candidates_blocking, hover_symbol_blocking,
    inspect_language_service_blocking,
};
use crate::services::language_service::LanguageRuntime;

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
    hover_symbol_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn goto_definition(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<DefinitionTarget>, String> {
    goto_definition_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn goto_definition_candidates(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    goto_definition_candidates_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn complete_symbol(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<CompletionItem>, String> {
    complete_symbol_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn document_symbols(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DocumentSymbol>, String> {
    document_symbols_blocking(app, runtime.inner().clone(), request).await
}

#[tauri::command]
pub async fn find_usages(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<UsageResult>, String> {
    find_usages_blocking(app, runtime.inner().clone(), request).await
}
