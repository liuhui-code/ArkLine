use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, State};

use crate::commands::workspace_emit::{
    emit_workspace_index_events, emit_workspace_index_task_update,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};

#[tauri::command]
pub async fn schedule_foreground_completion_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    let index_runtime = index_runtime.inner().clone();
    let index_manager = index_manager.inner().clone();
    let ui_activity = ui_activity.inner().clone();
    spawn_blocking(move || {
        let scheduled = schedule_foreground_completion_index_through_manager(
            &index_manager,
            &root_path,
            &changed_paths,
        )?;
        start_admitted_index_worker(
            scheduled,
            WorkspaceIndexUiActivityKind::Completion,
            app_handle,
            index_runtime,
            index_manager,
            ui_activity,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn schedule_foreground_navigation_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    let index_runtime = index_runtime.inner().clone();
    let index_manager = index_manager.inner().clone();
    let ui_activity = ui_activity.inner().clone();
    spawn_blocking(move || {
        let scheduled = schedule_foreground_navigation_index_through_manager(
            &index_manager,
            &root_path,
            &changed_paths,
        )?;
        start_admitted_index_worker(
            scheduled,
            WorkspaceIndexUiActivityKind::Navigation,
            app_handle,
            index_runtime,
            index_manager,
            ui_activity,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn schedule_visible_files_index(
    root_path: String,
    changed_paths: Vec<String>,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
    ui_activity: State<'_, WorkspaceIndexUiActivityRuntime>,
) -> Result<(), String> {
    let index_runtime = index_runtime.inner().clone();
    let index_manager = index_manager.inner().clone();
    let ui_activity = ui_activity.inner().clone();
    spawn_blocking(move || {
        let scheduled = schedule_visible_files_index_through_manager(
            &index_manager,
            &root_path,
            &changed_paths,
        )?;
        start_admitted_index_worker(
            scheduled,
            WorkspaceIndexUiActivityKind::FileOpen,
            app_handle,
            index_runtime,
            index_manager,
            ui_activity,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn schedule_foreground_completion_index_through_manager(
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
    changed_paths: &[String],
) -> Result<bool, String> {
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
) -> Result<bool, String> {
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
) -> Result<bool, String> {
    index_manager.schedule_changed_path_task(
        root_path,
        changed_paths,
        WorkspaceIndexTaskPriority::VisibleFiles,
        "visible-files",
    )
}

fn start_admitted_index_worker(
    scheduled: bool,
    activity_kind: WorkspaceIndexUiActivityKind,
    app_handle: AppHandle,
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
) -> Result<(), String> {
    if !scheduled {
        return Ok(());
    }
    ui_activity.record_ui_activity(activity_kind, current_time_millis() as u64)?;
    start_index_worker(app_handle, index_runtime, index_manager, ui_activity)
}

fn start_index_worker(
    app_handle: AppHandle,
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
) -> Result<(), String> {
    let app_handle = app_handle.clone();
    let callback_runtime = index_runtime.clone();
    index_manager.start_background_worker_with_events_and_ui_activity(
        index_runtime,
        move |status, events| {
            emit_workspace_index_task_update(&app_handle, &callback_runtime, status);
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
