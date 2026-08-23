use std::path::PathBuf;

use tauri::async_runtime::spawn_blocking;

use crate::models::diagnostics::ValidationProblem;
use crate::services::document_service::{
    read_text_file, write_text_file, write_text_file_if_unchanged,
};
use crate::services::validation_service::validate_text_document_content;

pub async fn open_text_document_blocking(path: String) -> Result<String, String> {
    spawn_blocking(move || read_text_file(&PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn save_text_document_blocking(
    path: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), String> {
    spawn_blocking(move || {
        let path = PathBuf::from(path);
        match expected_content {
            Some(expected) => write_text_file_if_unchanged(&path, &content, &expected),
            None => write_text_file(&path, &content),
        }
    })
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
