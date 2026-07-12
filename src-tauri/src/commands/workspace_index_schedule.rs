use tauri::{AppHandle, Emitter, State};

use crate::commands::workspace_emit::emit_workspace_index_events;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};

#[tauri::command]
pub fn schedule_foreground_completion_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    ui_activity.record_ui_activity(
        WorkspaceIndexUiActivityKind::Completion,
        current_time_millis() as u64,
    )?;
    schedule_foreground_completion_index_through_manager(
        &index_manager,
        &root_path,
        &changed_paths,
    )?;
    start_index_worker(app_handle, index_runtime, index_manager, ui_activity)
}

#[tauri::command]
pub fn schedule_foreground_navigation_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    ui_activity.record_ui_activity(
        WorkspaceIndexUiActivityKind::Navigation,
        current_time_millis() as u64,
    )?;
    schedule_foreground_navigation_index_through_manager(
        &index_manager,
        &root_path,
        &changed_paths,
    )?;
    start_index_worker(app_handle, index_runtime, index_manager, ui_activity)
}

#[tauri::command]
pub fn schedule_visible_files_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    ui_activity.record_ui_activity(
        WorkspaceIndexUiActivityKind::FileOpen,
        current_time_millis() as u64,
    )?;
    schedule_visible_files_index_through_manager(&index_manager, &root_path, &changed_paths)?;
    start_index_worker(app_handle, index_runtime, index_manager, ui_activity)
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
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    let app_handle = app_handle.clone();
    let ui_activity = ui_activity.inner().clone();
    index_manager.start_background_worker_with_events_and_ui_activity(
        index_runtime.inner().clone(),
        move |status, events| {
            let _ = app_handle.emit("workspace-index-task-updated", status);
            emit_workspace_index_events(&app_handle, &events);
        },
        move || {
            ui_activity
                .is_latency_sensitive(current_time_millis() as u64)
                .unwrap_or(false)
        },
    )?;
    Ok(())
}
