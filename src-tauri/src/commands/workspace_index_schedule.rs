use tauri::{AppHandle, Emitter, State};

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

#[tauri::command]
pub fn schedule_foreground_completion_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<(), String> {
    schedule_foreground_completion_index_through_manager(
        &index_manager,
        &root_path,
        &changed_paths,
    )?;
    start_index_worker(app_handle, index_runtime, index_manager)
}

#[tauri::command]
pub fn schedule_foreground_navigation_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<(), String> {
    schedule_foreground_navigation_index_through_manager(
        &index_manager,
        &root_path,
        &changed_paths,
    )?;
    start_index_worker(app_handle, index_runtime, index_manager)
}

#[tauri::command]
pub fn schedule_visible_files_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<(), String> {
    schedule_visible_files_index_through_manager(&index_manager, &root_path, &changed_paths)?;
    start_index_worker(app_handle, index_runtime, index_manager)
}

pub(super) fn schedule_foreground_completion_index_through_manager(
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
    changed_paths: &[String],
) -> Result<(), String> {
    index_manager.schedule_changed_path_task(
        root_path,
        changed_paths,
        WorkspaceIndexTaskPriority::ForegroundCompletion,
        "foreground-completion",
    )
}

pub(super) fn schedule_foreground_navigation_index_through_manager(
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
    changed_paths: &[String],
) -> Result<(), String> {
    index_manager.schedule_changed_path_task(
        root_path,
        changed_paths,
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        "foreground-navigation",
    )
}

pub(super) fn schedule_visible_files_index_through_manager(
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
    changed_paths: &[String],
) -> Result<(), String> {
    index_manager.schedule_changed_path_task(
        root_path,
        changed_paths,
        WorkspaceIndexTaskPriority::VisibleFiles,
        "visible-files",
    )
}

fn start_index_worker(
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<(), String> {
    let app_handle = app_handle.clone();
    index_manager.start_background_worker(index_runtime.inner().clone(), move |status| {
        let _ = app_handle.emit("workspace-index-task-updated", status);
    })?;
    Ok(())
}
