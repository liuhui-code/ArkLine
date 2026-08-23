use crate::models::diagnostics::ValidationQueryResult;
use crate::models::language::LanguageQueryRequest;
use crate::services::document_command_service::{
    open_text_document_blocking, save_text_document_blocking, validate_text_document_blocking,
};
use crate::services::language_command_service::validate_document_blocking;
use crate::services::language_service::LanguageRuntime;
use crate::services::validation_service::merge_validation_results;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn open_text_document(path: String) -> Result<String, String> {
    open_text_document_blocking(path).await
}

#[tauri::command]
pub async fn save_text_document(
    path: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), String> {
    save_text_document_blocking(path, content, expected_content).await
}

#[tauri::command]
pub async fn validate_text_document(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
    path: String,
    content: String,
) -> Result<ValidationQueryResult, String> {
    let local = validate_text_document_blocking(path.clone(), content.clone()).await?;
    let semantic = validate_document_blocking(
        app,
        runtime.inner().clone(),
        LanguageQueryRequest {
            path,
            line: 1,
            column: 1,
            content: Some(content),
        },
    )
    .await?;
    Ok(merge_validation_results(local, semantic))
}
