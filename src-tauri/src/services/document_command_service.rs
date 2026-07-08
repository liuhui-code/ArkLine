use std::path::PathBuf;

use tauri::async_runtime::spawn_blocking;

use crate::models::diagnostics::ValidationProblem;
use crate::services::document_service::{read_text_file, write_text_file};
use crate::services::validation_service::validate_text_document_content;

pub async fn open_text_document_blocking(path: String) -> Result<String, String> {
    spawn_blocking(move || read_text_file(&PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn save_text_document_blocking(path: String, content: String) -> Result<(), String> {
    spawn_blocking(move || write_text_file(&PathBuf::from(path), &content))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn validate_text_document_blocking(
    path: String,
    content: String,
) -> Result<Vec<ValidationProblem>, String> {
    spawn_blocking(move || validate_text_document_content(&path, &content))
        .await
        .map_err(|error| error.to_string())
}
