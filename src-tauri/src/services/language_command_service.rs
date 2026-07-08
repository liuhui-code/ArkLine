use tauri::async_runtime::spawn_blocking;
use tauri::AppHandle;

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, UsageResult,
};
use crate::services::language_service::{
    complete_symbol, find_usages, goto_definition, goto_definition_candidates, hover_symbol,
    inspect_runtime, list_document_symbols, LanguageRuntime,
};
use crate::services::settings_store::load_settings_for_app;

pub async fn inspect_language_service_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
) -> Result<LanguageServiceReport, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(inspect_runtime(&runtime, &settings))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn hover_symbol_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Option<HoverResponse>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(hover_symbol(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn goto_definition_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Option<DefinitionTarget>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(goto_definition(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn goto_definition_candidates_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(goto_definition_candidates(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn complete_symbol_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Vec<CompletionItem>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(complete_symbol(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn document_symbols_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Vec<DocumentSymbol>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(list_document_symbols(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn find_usages_blocking(
    app: AppHandle,
    runtime: LanguageRuntime,
    request: LanguageQueryRequest,
) -> Result<Vec<UsageResult>, String> {
    spawn_blocking(move || {
        let settings = load_settings_for_app(&app)?;
        Ok(find_usages(&runtime, &settings, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}
