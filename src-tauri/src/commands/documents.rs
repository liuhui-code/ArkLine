use crate::models::diagnostics::ValidationProblem;
use crate::services::document_command_service::{
    open_text_document_blocking, save_text_document_blocking, validate_text_document_blocking,
};

#[tauri::command]
pub async fn open_text_document(path: String) -> Result<String, String> {
    open_text_document_blocking(path).await
}

#[tauri::command]
pub async fn save_text_document(path: String, content: String) -> Result<(), String> {
    save_text_document_blocking(path, content).await
}

#[tauri::command]
pub async fn validate_text_document(
    path: String,
    content: String,
) -> Result<Vec<ValidationProblem>, String> {
    validate_text_document_blocking(path, content).await
}
