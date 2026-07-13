use std::path::Path;

use crate::models::workspace::WorkspaceIndexRefreshResult;
use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, WorkspaceFileFingerprintStatus,
};
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_chunk_service::chunk_paths;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_worker_service::WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE;

pub(crate) fn refresh_changed_path_chunks(
    index_runtime: &WorkspaceIndexRuntime,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    changed_paths: Vec<String>,
) -> Result<Option<WorkspaceIndexRefreshResult>, String> {
    let chunks = chunk_paths(changed_paths, WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE);
    let mut combined: Option<WorkspaceIndexRefreshResult> = None;

    for chunk in chunks {
        if token.is_cancelled() {
            return Ok(None);
        }
        let result = index_runtime.refresh_workspace_index_for_changed_paths_with_priority(
            &task.root_path,
            &chunk,
            task.priority,
        )?;
        combined = Some(match combined {
            Some(previous) => combine_refresh_results(previous, result),
            None => result,
        });
    }

    combined
        .map(Some)
        .ok_or_else(|| "No changed path chunks to refresh".to_string())
}

pub(crate) fn changed_paths_for_task(task: &WorkspaceIndexTask) -> Result<Vec<String>, String> {
    if task.changed_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut paths = stale_changed_paths(&task.root_path, &task.changed_paths)?;
    if is_user_visible_readiness_task(task.priority) {
        paths.extend(paths_missing_current_file_readiness(
            &task.root_path,
            &task.changed_paths,
        )?);
        paths.sort();
        paths.dedup();
    }
    Ok(paths)
}

pub(crate) fn is_user_visible_readiness_task(priority: WorkspaceIndexTaskPriority) -> bool {
    matches!(
        priority,
        WorkspaceIndexTaskPriority::ForegroundNavigation
            | WorkspaceIndexTaskPriority::ForegroundCompletion
            | WorkspaceIndexTaskPriority::VisibleFiles
    )
}

pub(crate) fn existing_file_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| Path::new(path.as_str()).is_file())
        .cloned()
        .collect()
}

fn combine_refresh_results(
    mut previous: WorkspaceIndexRefreshResult,
    next: WorkspaceIndexRefreshResult,
) -> WorkspaceIndexRefreshResult {
    previous.changed = previous.changed || next.changed;
    previous.added_paths.extend(next.added_paths);
    previous.added_paths.sort();
    previous.added_paths.dedup();
    previous.removed_paths.extend(next.removed_paths);
    previous.removed_paths.sort();
    previous.removed_paths.dedup();
    previous.state = next.state;
    previous
}

fn stale_changed_paths(root_path: &str, changed_paths: &[String]) -> Result<Vec<String>, String> {
    let changes = classify_file_fingerprints(root_path, changed_paths)?;
    Ok(changes
        .into_iter()
        .filter(|change| change.status != WorkspaceFileFingerprintStatus::Unchanged)
        .map(|change| change.path)
        .collect())
}

fn paths_missing_current_file_readiness(
    root_path: &str,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    for path in paths {
        let readiness = get_workspace_index_file_readiness(root_path, path)?;
        if readiness.file_index != "ready" || readiness.symbol_index != "ready" {
            missing.push(path.clone());
        }
    }
    Ok(missing)
}
