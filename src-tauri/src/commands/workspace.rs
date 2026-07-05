use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use crate::models::workspace::{
    WorkspaceDirectoryEntry, WorkspaceIndexDiagnostics, WorkspaceIndexHealth,
    WorkspaceIndexParserFailure, WorkspaceIndexQueryEnvelope, WorkspaceIndexRefreshResult,
    WorkspaceIndexState, WorkspaceIndexTaskStatus, WorkspaceIndexUnresolvedImport,
    WorkspaceSearchCandidate, WorkspaceSnapshot, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::diff_service::load_workspace_diff_text;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index_with_queue_pressure as inspect_workspace_index_service;
use crate::services::workspace_index_facade_service::{
    query_facade_file_symbols_with_readiness as query_workspace_file_symbols_with_readiness_facade,
    query_facade_search_everywhere_with_readiness as query_workspace_candidates_with_readiness_facade,
    query_facade_text_search_result,
};
use crate::services::workspace_index_health_service::get_workspace_index_health as get_workspace_index_health_service;
use crate::services::workspace_index_maintenance_service::{
    clear_workspace_index as clear_workspace_index_service,
    rebuild_workspace_index as rebuild_workspace_index_service,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::{
    query_workspace_quick_open as query_workspace_quick_open_service,
    query_workspace_search_everywhere as query_workspace_search_everywhere_service,
    WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_repair_service::{
    inspect_parser_failures as inspect_parser_failures_service,
    inspect_unresolved_imports as inspect_unresolved_imports_service,
    load_active_sdk_repair_target,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_watcher_service::WorkspaceIndexWatcherRuntime;
use crate::services::workspace_sdk_index_service::WorkspaceSdkIndexSummary;
use crate::services::workspace_service::{
    list_workspace_directory as list_workspace_directory_service, scan_workspace_for_open,
};

#[tauri::command]
pub fn open_workspace(
    root_path: String,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceSnapshot, String> {
    let app_handle = app_handle.clone();
    open_workspace_through_manager(
        index_runtime.inner().clone(),
        index_manager.inner().clone(),
        &root_path,
        move |status| {
            let _ = app_handle.emit("workspace-index-task-updated", status);
        },
    )
}

pub(super) fn open_workspace_through_manager<F>(
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    root_path: &str,
    on_status: F,
) -> Result<WorkspaceSnapshot, String>
where
    F: Fn(WorkspaceIndexTaskStatus) + Send + 'static,
{
    let snapshot = scan_workspace_for_open(&PathBuf::from(root_path))?;
    index_manager.open_workspace_index(root_path)?;
    index_manager.start_background_worker(index_runtime, on_status)?;
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
pub fn inspect_workspace_index(
    root_path: String,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceIndexDiagnostics, String> {
    let queue_pressure = index_manager.get_queue_pressure(&root_path)?;
    inspect_workspace_index_service(&root_path, queue_pressure)
}

#[tauri::command]
pub fn get_workspace_index_health(
    root_path: String,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceIndexHealth, String> {
    get_workspace_index_health_service(&root_path, &index_manager)
}

#[tauri::command]
pub fn get_workspace_index_task_statuses(
    root_path: String,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<Vec<WorkspaceIndexTaskStatus>, String> {
    index_manager.get_index_task_statuses(&root_path)
}

#[tauri::command]
pub fn clear_workspace_index(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<(), String> {
    clear_workspace_index_service(&index_runtime, &root_path)
}

#[tauri::command]
pub fn rebuild_workspace_index(
    root_path: String,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<(), String> {
    rebuild_workspace_index_service(&index_runtime, &root_path)
}

#[tauri::command]
pub fn resume_workspace_indexing(
    root_path: String,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<(), String> {
    index_manager.open_workspace_index(&root_path)
}

#[tauri::command]
pub fn rebuild_workspace_sdk_index(
    root_path: String,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceIndexTaskStatus, String> {
    let target = load_active_sdk_repair_target(&root_path)?
        .ok_or_else(|| "No active SDK index metadata available".to_string())?;
    let app_handle = app_handle.clone();
    submit_workspace_sdk_index_through_manager(
        index_runtime.inner().clone(),
        index_manager.inner().clone(),
        &root_path,
        &target.sdk_path,
        &target.sdk_version,
        move |status| {
            let _ = app_handle.emit("workspace-index-task-updated", status);
        },
    )
}

#[tauri::command]
pub fn inspect_workspace_parser_failures(
    root_path: String,
    limit: usize,
) -> Result<Vec<WorkspaceIndexParserFailure>, String> {
    inspect_parser_failures_service(&root_path, limit)
}

#[tauri::command]
pub fn inspect_workspace_unresolved_imports(
    root_path: String,
    limit: usize,
) -> Result<Vec<WorkspaceIndexUnresolvedImport>, String> {
    inspect_unresolved_imports_service(&root_path, limit)
}

#[tauri::command]
pub fn index_workspace_sdk_symbols(
    root_path: String,
    sdk_path: String,
    sdk_version: String,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceSdkIndexSummary, String> {
    let (summary, statuses) = index_workspace_sdk_symbols_through_manager_with_status(
        &index_runtime,
        &index_manager,
        &root_path,
        &sdk_path,
        &sdk_version,
    )?;
    emit_workspace_index_task_statuses(&app_handle, &statuses);
    Ok(summary)
}

#[tauri::command]
pub fn submit_workspace_sdk_index(
    root_path: String,
    sdk_path: String,
    sdk_version: String,
    app_handle: AppHandle,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
    index_manager: State<'_, WorkspaceIndexManagerRuntime>,
) -> Result<WorkspaceIndexTaskStatus, String> {
    let app_handle = app_handle.clone();
    submit_workspace_sdk_index_through_manager(
        index_runtime.inner().clone(),
        index_manager.inner().clone(),
        &root_path,
        &sdk_path,
        &sdk_version,
        move |status| {
            let _ = app_handle.emit("workspace-index-task-updated", status);
        },
    )
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
pub fn query_workspace_candidates(
    root_path: String,
    query: String,
    scope: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    Ok(query_workspace_candidates_with_readiness_facade(
        &index_runtime,
        &root_path,
        &query,
        parse_index_query_scope(&scope)?,
        limit,
    )?
    .items)
}

#[tauri::command]
pub fn query_workspace_candidates_with_readiness(
    root_path: String,
    query: String,
    scope: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_candidates_with_readiness_facade(
        &index_runtime,
        &root_path,
        &query,
        parse_index_query_scope(&scope)?,
        limit,
    )
}

#[tauri::command]
pub fn query_workspace_file_symbols(
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    Ok(query_workspace_file_symbols_with_readiness_facade(
        &index_runtime,
        &root_path,
        &file_path,
        &query,
        limit,
    )?
    .items)
}

#[tauri::command]
pub fn query_workspace_file_symbols_with_readiness(
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_file_symbols_with_readiness_facade(
        &index_runtime,
        &root_path,
        &file_path,
        &query,
        limit,
    )
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
    query_facade_text_search_result(&index_runtime, request)
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

fn parse_index_query_scope(scope: &str) -> Result<WorkspaceIndexQueryScope, String> {
    match scope {
        "all" => Ok(WorkspaceIndexQueryScope::All),
        "files" => Ok(WorkspaceIndexQueryScope::Files),
        "classes" => Ok(WorkspaceIndexQueryScope::Classes),
        "symbols" => Ok(WorkspaceIndexQueryScope::Symbols),
        "api" => Ok(WorkspaceIndexQueryScope::Apis),
        "text" => Ok(WorkspaceIndexQueryScope::Text),
        value => Err(format!("Unsupported workspace index query scope: {value}")),
    }
}

pub(super) fn index_workspace_sdk_symbols_through_manager_with_status(
    index_runtime: &WorkspaceIndexRuntime,
    index_manager: &WorkspaceIndexManagerRuntime,
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
) -> Result<(WorkspaceSdkIndexSummary, Vec<WorkspaceIndexTaskStatus>), String> {
    index_manager.schedule_sdk_index(root_path, sdk_path, sdk_version)?;
    let mut statuses = Vec::new();
    let sdk_result = index_manager
        .run_index_worker_once(index_runtime, |status| statuses.push(status))?
        .into_iter()
        .find(|result| result.kind == "sdk" && result.root_path == root_path)
        .ok_or_else(|| "SDK index task did not produce a result".to_string())?;

    if sdk_result.status != "ready" {
        return Err(format!(
            "SDK index task failed with status {}",
            sdk_result.status
        ));
    }

    Ok((
        WorkspaceSdkIndexSummary {
            symbol_count: sdk_result.sdk_symbol_count.unwrap_or_default(),
        },
        statuses,
    ))
}

pub(super) fn submit_workspace_sdk_index_through_manager<F>(
    index_runtime: WorkspaceIndexRuntime,
    index_manager: WorkspaceIndexManagerRuntime,
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    on_status: F,
) -> Result<WorkspaceIndexTaskStatus, String>
where
    F: Fn(WorkspaceIndexTaskStatus) + Send + 'static,
{
    index_manager.schedule_sdk_index(root_path, sdk_path, sdk_version)?;
    let queued = index_manager
        .get_index_task_statuses(root_path)?
        .into_iter()
        .rev()
        .find(|status| status.kind == "sdk" && status.status == "queued")
        .ok_or_else(|| "SDK index task was not queued".to_string())?;
    index_manager.start_background_worker(index_runtime, on_status)?;
    Ok(queued)
}

fn emit_workspace_index_task_statuses(
    app_handle: &AppHandle,
    statuses: &[WorkspaceIndexTaskStatus],
) {
    for status in statuses {
        let _ = app_handle.emit("workspace-index-task-updated", status);
    }
}
