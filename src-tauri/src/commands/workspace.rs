use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::models::workspace::{
    WorkspaceDirectoryEntry, WorkspaceIndexRefreshResult, WorkspaceIndexState,
    WorkspaceSearchCandidate, WorkspaceSnapshot, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::diff_service::load_workspace_diff_text;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::{
    query_workspace_quick_open as query_workspace_quick_open_service,
    query_workspace_search_everywhere as query_workspace_search_everywhere_service,
    search_workspace_text as search_workspace_text_query_service,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_watcher_service::WorkspaceIndexWatcherRuntime;
use crate::services::workspace_service::{
    list_workspace_directory as list_workspace_directory_service, scan_workspace,
};

#[tauri::command]
pub fn open_workspace(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceSnapshot, String> {
    let snapshot = scan_workspace(&PathBuf::from(root_path))?;
    index_runtime.index_workspace_snapshot(&snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn list_workspace_directory(
    root_path: String,
    directory_path: String,
) -> Result<Vec<WorkspaceDirectoryEntry>, String> {
    list_workspace_directory_service(&PathBuf::from(root_path), &PathBuf::from(directory_path))
}

#[tauri::command]
pub fn get_workspace_index_state(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexState, String> {
    index_runtime.get_index_state(&root_path)
}

#[tauri::command]
pub fn query_workspace_quick_open(
    root_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_quick_open_service(&index_runtime, &root_path, &query, limit)
}

#[tauri::command]
pub fn query_workspace_search_everywhere(
    root_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_search_everywhere_service(&index_runtime, &root_path, &query, limit)
}

#[tauri::command]
pub fn update_workspace_index_files(
    root_path: String,
    added_paths: Vec<String>,
    removed_paths: Vec<String>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexState, String> {
    index_runtime.update_workspace_files(&root_path, &added_paths, &removed_paths)
}

#[tauri::command]
pub fn refresh_workspace_index(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexState, String> {
    index_runtime.refresh_workspace_index(&root_path)
}

#[tauri::command]
pub fn refresh_workspace_index_with_changes(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceIndexRefreshResult, String> {
    index_manager.refresh_workspace_index(&root_path)?;
    index_manager
        .drain_index_tasks(&index_runtime)?
        .into_iter()
        .last()
        .ok_or_else(|| "Workspace index refresh did not produce a result".to_string())
}

#[tauri::command]
pub fn search_workspace_text(
    request: WorkspaceTextSearchRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceTextSearchResult, String> {
    search_workspace_text_query_service(&index_runtime, request)
}

#[tauri::command]
pub fn watch_workspace_index(
    root_path: String,
    app_handle: AppHandle,
    watcher_runtime: State<'_, WorkspaceIndexWatcherRuntime>,
) -> Result<(), String> {
    watcher_runtime.watch_workspace_index(app_handle, &root_path)
}

#[tauri::command]
pub fn unwatch_workspace_index(
    root_path: String,
    watcher_runtime: State<'_, WorkspaceIndexWatcherRuntime>,
) -> Result<(), String> {
    watcher_runtime.unwatch_workspace_index(&root_path)
}

#[tauri::command]
pub fn load_workspace_diff(root_path: Option<String>) -> Result<String, String> {
    match root_path {
        Some(path) => load_workspace_diff_text(&PathBuf::from(path)),
        None => Ok(String::new()),
    }
}
