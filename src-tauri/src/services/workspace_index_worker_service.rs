use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_dependency_graph_service::{
    has_graph_affecting_config_change, mark_dependency_graph_stale,
};
use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, WorkspaceFileFingerprintStatus,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_lifecycle_service::task_kind_replaces_pending;
use crate::services::workspace_index_task_status_service::{
    current_time_millis, failed_task_result, refresh_task_result, skipped_task_result,
    superseded_task_result_from_task, task_status_from_task, WorkspaceIndexTaskResult,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

pub fn run_index_tasks<F>(
    index_runtime: &WorkspaceIndexRuntime,
    tasks: Vec<WorkspaceIndexTask>,
    mut on_status: F,
) -> Result<Vec<WorkspaceIndexTaskResult>, String>
where
    F: FnMut(WorkspaceIndexTaskStatus) -> Result<(), String>,
{
    let mut results = Vec::new();

    for (task_index, task) in tasks.iter().enumerate() {
        if is_superseded_by_later_batch_task(&tasks, task_index) {
            results.push(superseded_task_result_from_task(task));
            continue;
        }
        on_status(task_status_from_task(task, "running", None, None))?;
        let started_at = current_time_millis();
        match run_index_task(index_runtime, task.clone(), started_at) {
            Ok(Some(result)) => results.push(result),
            Ok(None) => {}
            Err((task, error)) => results.push(failed_task_result(task, error, started_at)),
        }
    }

    Ok(results)
}

fn is_superseded_by_later_batch_task(tasks: &[WorkspaceIndexTask], task_index: usize) -> bool {
    let task = &tasks[task_index];
    tasks.iter().skip(task_index + 1).any(|candidate| {
        candidate.root_path == task.root_path
            && candidate.generation > task.generation
            && task_kind_replaces_pending(&candidate.kind, &task.kind)
    })
}

fn run_index_task(
    index_runtime: &WorkspaceIndexRuntime,
    task: WorkspaceIndexTask,
    started_at: u128,
) -> Result<Option<WorkspaceIndexTaskResult>, (WorkspaceIndexTask, String)> {
    run_index_task_inner(index_runtime, &task, started_at).map_err(|error| (task, error))
}

fn run_index_task_inner(
    index_runtime: &WorkspaceIndexRuntime,
    task: &WorkspaceIndexTask,
    started_at: u128,
) -> Result<Option<WorkspaceIndexTaskResult>, String> {
    match task.kind.clone() {
        WorkspaceIndexTaskKind::ChangedPaths => {
            let changed_paths = stale_changed_paths(&task.root_path, &task.changed_paths)?;
            if changed_paths.is_empty() {
                return Ok(Some(skipped_task_result(
                    task,
                    "No changed paths require reindexing",
                    started_at,
                )));
            }
            if has_graph_affecting_config_change(&changed_paths) {
                mark_dependency_graph_stale(&task.root_path, "config-change")?;
                let refresh_result =
                    index_runtime.refresh_workspace_index_with_changes(&task.root_path)?;
                let mut config_task = task.clone();
                config_task.reason = "config-change".to_string();
                return Ok(Some(refresh_task_result(
                    &config_task,
                    "config-change",
                    refresh_result,
                    started_at,
                )));
            }
            let refresh_result = index_runtime
                .refresh_workspace_index_for_changed_paths(&task.root_path, &changed_paths)?;
            Ok(Some(refresh_task_result(
                task,
                "changed-paths",
                refresh_result,
                started_at,
            )))
        }
        WorkspaceIndexTaskKind::OpenWorkspace | WorkspaceIndexTaskKind::RefreshWorkspace => {
            let kind = if task.kind == WorkspaceIndexTaskKind::OpenWorkspace {
                "open-workspace"
            } else {
                "refresh-workspace"
            };
            let refresh_result =
                index_runtime.refresh_workspace_index_with_changes(&task.root_path)?;
            Ok(Some(refresh_task_result(
                task,
                kind,
                refresh_result,
                started_at,
            )))
        }
        WorkspaceIndexTaskKind::IndexSdk => {
            let sdk_path = task
                .sdk_path
                .clone()
                .ok_or_else(|| "SDK index task missing sdk path".to_string())?;
            let sdk_version = task
                .sdk_version
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let summary = index_workspace_sdk_symbols(&task.root_path, &sdk_path, &sdk_version)?;
            Ok(Some(WorkspaceIndexTaskResult {
                root_path: task.root_path.to_string(),
                kind: "sdk".to_string(),
                status: "ready".to_string(),
                reason: task.reason.to_string(),
                generation: task.generation,
                started_at: Some(started_at),
                finished_at: Some(current_time_millis()),
                message: None,
                error: None,
                refresh_result: None,
                sdk_symbol_count: Some(summary.symbol_count),
            }))
        }
    }
}

fn stale_changed_paths(root_path: &str, changed_paths: &[String]) -> Result<Vec<String>, String> {
    let changes = classify_file_fingerprints(root_path, changed_paths)?;
    Ok(changes
        .into_iter()
        .filter(|change| change.status != WorkspaceFileFingerprintStatus::Unchanged)
        .map(|change| change.path)
        .collect())
}
