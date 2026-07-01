use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use crate::models::workspace::{
    WorkspaceDirectoryEntry, WorkspaceIndexDiagnostics, WorkspaceIndexQueryEnvelope,
    WorkspaceIndexRefreshResult, WorkspaceIndexState, WorkspaceIndexTaskStatus,
    WorkspaceSearchCandidate, WorkspaceSnapshot, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::diff_service::load_workspace_diff_text;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index as inspect_workspace_index_service;
use crate::services::workspace_index_entity_query_service::query_workspace_file_symbols as query_workspace_file_symbols_service;
use crate::services::workspace_index_maintenance_service::{
    clear_workspace_index as clear_workspace_index_service,
    rebuild_workspace_index as rebuild_workspace_index_service,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::{
    query_workspace_candidates as query_workspace_candidates_service,
    query_workspace_candidates_with_readiness as query_workspace_candidates_with_readiness_service,
    query_workspace_file_symbols_with_readiness as query_workspace_file_symbols_with_readiness_service,
    query_workspace_quick_open as query_workspace_quick_open_service,
    query_workspace_search_everywhere as query_workspace_search_everywhere_service,
    search_workspace_text as search_workspace_text_query_service, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_watcher_service::WorkspaceIndexWatcherRuntime;
use crate::services::workspace_sdk_index_service::WorkspaceSdkIndexSummary;
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
pub fn inspect_workspace_index(root_path: String) -> Result<WorkspaceIndexDiagnostics, String> {
    inspect_workspace_index_service(&root_path)
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
    query_workspace_candidates_service(
        &index_runtime,
        &root_path,
        &query,
        parse_index_query_scope(&scope)?,
        limit,
    )
}

#[tauri::command]
pub fn query_workspace_candidates_with_readiness(
    root_path: String,
    query: String,
    scope: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_candidates_with_readiness_service(
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
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_file_symbols_service(&root_path, &file_path, &query, limit)
}

#[tauri::command]
pub fn query_workspace_file_symbols_with_readiness(
    root_path: String,
    file_path: String,
    query: String,
    limit: usize,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_workspace_file_symbols_with_readiness_service(
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

fn parse_index_query_scope(scope: &str) -> Result<WorkspaceIndexQueryScope, String> {
    match scope {
        "all" => Ok(WorkspaceIndexQueryScope::All),
        "files" => Ok(WorkspaceIndexQueryScope::Files),
        "classes" => Ok(WorkspaceIndexQueryScope::Classes),
        "symbols" => Ok(WorkspaceIndexQueryScope::Symbols),
        "api" => Ok(WorkspaceIndexQueryScope::Apis),
        value => Err(format!("Unsupported workspace index query scope: {value}")),
    }
}

fn index_workspace_sdk_symbols_through_manager_with_status(
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

fn submit_workspace_sdk_index_through_manager<F>(
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::commands::workspace::{
        index_workspace_sdk_symbols_through_manager_with_status,
        submit_workspace_sdk_index_through_manager,
    };
    use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
    use crate::services::workspace_index_service::WorkspaceIndexRuntime;
    use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-command-workspace-{name}-{suffix}"))
    }

    #[test]
    fn sdk_index_command_uses_manager_task_result_summary() {
        let root = unique_temp_dir("sdk-command");
        let sdk_root = root.join("openharmony");
        fs::create_dir_all(sdk_root.join("ets")).unwrap();
        fs::write(
            sdk_root.join("ets").join("arkui.d.ts"),
            "declare class Text {\n  width(value: Length): Text;\n}\n",
        )
        .unwrap();
        let root_path = root.to_string_lossy().to_string();
        let sdk_path = sdk_root.to_string_lossy().to_string();
        let index_runtime = WorkspaceIndexRuntime::default();
        let index_manager = WorkspaceIndexManagerRuntime::default();

        let (summary, _) = index_workspace_sdk_symbols_through_manager_with_status(
            &index_runtime,
            &index_manager,
            &root_path,
            &sdk_path,
            "test-sdk",
        )
        .unwrap();
        let matches = query_workspace_sdk_symbols(&root_path, "Text width", 8).unwrap();

        assert_eq!(summary.symbol_count, 2);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].title, "width");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sdk_index_command_collects_worker_statuses() {
        let root = unique_temp_dir("sdk-command-status");
        let sdk_root = root.join("openharmony");
        fs::create_dir_all(sdk_root.join("ets")).unwrap();
        fs::write(
            sdk_root.join("ets").join("arkui.d.ts"),
            "declare class Text {\n  width(value: Length): Text;\n}\n",
        )
        .unwrap();
        let root_path = root.to_string_lossy().to_string();
        let sdk_path = sdk_root.to_string_lossy().to_string();
        let index_runtime = WorkspaceIndexRuntime::default();
        let index_manager = WorkspaceIndexManagerRuntime::default();

        let (_, statuses) = index_workspace_sdk_symbols_through_manager_with_status(
            &index_runtime,
            &index_manager,
            &root_path,
            &sdk_path,
            "test-sdk",
        )
        .unwrap();

        assert!(statuses
            .iter()
            .any(|status| status.kind == "sdk" && status.status == "running"));
        assert!(statuses
            .iter()
            .any(|status| status.kind == "sdk" && status.status == "ready"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn submit_sdk_index_command_returns_queued_status_and_finishes_in_background() {
        let root = unique_temp_dir("sdk-command-submit");
        let sdk_root = root.join("openharmony");
        fs::create_dir_all(sdk_root.join("ets")).unwrap();
        fs::write(
            sdk_root.join("ets").join("arkui.d.ts"),
            "declare class Text {\n  width(value: Length): Text;\n}\n",
        )
        .unwrap();
        let root_path = root.to_string_lossy().to_string();
        let sdk_path = sdk_root.to_string_lossy().to_string();
        let index_runtime = WorkspaceIndexRuntime::default();
        let index_manager = WorkspaceIndexManagerRuntime::default();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_for_worker = observed.clone();

        let queued = submit_workspace_sdk_index_through_manager(
            index_runtime,
            index_manager,
            &root_path,
            &sdk_path,
            "test-sdk",
            move |status| observed_for_worker.lock().unwrap().push(status.status),
        )
        .unwrap();

        assert_eq!(queued.kind, "sdk");
        assert_eq!(queued.status, "queued");
        for _ in 0..20 {
            if observed
                .lock()
                .unwrap()
                .iter()
                .any(|status| status == "ready")
            {
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        assert!(observed
            .lock()
            .unwrap()
            .iter()
            .any(|status| status == "ready"));

        fs::remove_dir_all(root).unwrap();
    }
}
