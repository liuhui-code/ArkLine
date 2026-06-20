use std::path::PathBuf;

use crate::models::workspace::WorkspaceSnapshot;
use crate::services::diff_service::load_workspace_diff_text;
use crate::services::workspace_service::scan_workspace;

#[tauri::command]
pub fn open_workspace(root_path: String) -> Result<WorkspaceSnapshot, String> {
    scan_workspace(&PathBuf::from(root_path))
}

#[tauri::command]
pub fn load_workspace_diff(root_path: Option<String>) -> Result<String, String> {
    match root_path {
        Some(path) => load_workspace_diff_text(&PathBuf::from(path)),
        None => Ok(String::new()),
    }
}
