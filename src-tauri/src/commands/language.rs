use tauri::State;

use crate::models::language::{
    CompletionItem, DefinitionTarget, HoverResponse, LanguageQueryRequest, LanguageServiceReport,
};
use crate::services::language_service::{
    complete_symbol as complete_symbol_impl, goto_definition as goto_definition_impl,
    hover_symbol as hover_symbol_impl, inspect_runtime as inspect_runtime_impl, LanguageRuntime,
};

#[tauri::command]
pub fn inspect_language_service(runtime: State<LanguageRuntime>) -> Result<LanguageServiceReport, String> {
    Ok(inspect_runtime_impl(runtime.inner()))
}

#[tauri::command]
pub fn hover_symbol(
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<HoverResponse>, String> {
    Ok(hover_symbol_impl(runtime.inner(), &request))
}

#[tauri::command]
pub fn goto_definition(
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Option<DefinitionTarget>, String> {
    Ok(goto_definition_impl(runtime.inner(), &request))
}

#[tauri::command]
pub fn complete_symbol(
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<CompletionItem>, String> {
    Ok(complete_symbol_impl(runtime.inner(), &request))
}
