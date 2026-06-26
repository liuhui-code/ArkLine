use std::path::PathBuf;

use crate::models::diagnostics::ValidationProblem;
use crate::services::document_service::{read_text_file, write_text_file};
use crate::services::validation_service::validate_text_document_content;

#[tauri::command]
pub fn open_text_document(path: String) -> Result<String, String> {
    read_text_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn save_text_document(path: String, content: String) -> Result<(), String> {
    write_text_file(&PathBuf::from(path), &content)
}

#[tauri::command]
pub fn validate_text_document(
    path: String,
    content: String,
) -> Result<Vec<ValidationProblem>, String> {
    Ok(validate_text_document_content(&path, &content))
}
