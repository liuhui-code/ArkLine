use tauri::{AppHandle, State};

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, UsageResult,
};
use crate::services::language_service::{
    complete_symbol as complete_symbol_impl, goto_definition as goto_definition_impl,
    goto_definition_candidates as goto_definition_candidates_impl,
    hover_symbol as hover_symbol_impl, inspect_runtime as inspect_runtime_impl,
    list_document_symbols as list_document_symbols_impl, find_usages as find_usages_impl,
    LanguageRuntime,
};
use crate::services::settings_store::load_settings_for_app;

#[tauri::command]
pub fn inspect_language_service(app: AppHandle, runtime: State<LanguageRuntime>) -> Result<LanguageServiceReport, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(inspect_runtime_impl(runtime.inner(), &settings))
}

#[tauri::command]
pub fn hover_symbol(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<HoverResponse>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(hover_symbol_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn goto_definition(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<DefinitionTarget>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(goto_definition_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn goto_definition_candidates(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(goto_definition_candidates_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn complete_symbol(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<CompletionItem>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(complete_symbol_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn document_symbols(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DocumentSymbol>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(list_document_symbols_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn find_usages(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<UsageResult>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(find_usages_impl(runtime.inner(), &settings, &request))
}
