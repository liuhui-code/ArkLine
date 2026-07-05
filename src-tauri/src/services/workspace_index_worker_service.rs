use std::path::Path;

use crate::models::workspace::{WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus};
use crate::services::workspace_dependency_graph_service::{
    has_graph_affecting_config_change, mark_dependency_graph_stale,
};
use crate::services::workspace_discovery_runner_service::run_workspace_discovery_chunk;
use crate::services::workspace_discovery_service::WorkspaceDiscoveryChunk;
use crate::services::workspace_discovery_task_service::{
    discovery_task_kind_label, is_workspace_discovery_task_reason, workspace_discovery_task_cursor,
};
use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, WorkspaceFileFingerprintStatus,
};
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_chunk_service::{chunk_paths, plan_refresh_continuation};
use crate::services::workspace_index_continuation_task_service::{
    continuation_phase, continuation_phase_label, is_full_refresh_continuation_reason,
    WorkspaceIndexContinuationPhase,
};
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_full_refresh_service::refresh_workspace_index_in_chunks;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_state_machine_service::WorkspaceIndexTaskState;
use crate::services::workspace_index_task_lifecycle_service::task_kind_replaces_pending;
use crate::services::workspace_index_task_status_service::{
    current_time_millis, failed_task_result, refresh_task_result, skipped_task_result,
    superseded_task_result_from_task, task_status_from_state_transition, WorkspaceIndexTaskResult,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;
use crate::services::workspace_service::scan_workspace;

pub const WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE: usize = 64;
pub const WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE: usize = 1024;
pub const WORKSPACE_DISCOVERY_CHUNK_SIZE: usize = 1024;

#[allow(dead_code)]
pub fn run_index_tasks<F>(
    index_runtime: &WorkspaceIndexRuntime,
    tasks: Vec<WorkspaceIndexTask>,
    mut on_status: F,
) -> Result<Vec<WorkspaceIndexTaskResult>, String>
where
    F: FnMut(WorkspaceIndexTaskStatus) -> Result<(), String>,
{
    run_index_tasks_with_cancellation(
        index_runtime,
        tasks
            .into_iter()
            .map(|task| {
                let token = WorkspaceIndexCancellationToken::new(task.generation);
                (task, token)
            })
            .collect(),
        &mut on_status,
    )
}

pub fn run_index_tasks_with_cancellation<F>(
    index_runtime: &WorkspaceIndexRuntime,
    tasks: Vec<(WorkspaceIndexTask, WorkspaceIndexCancellationToken)>,
    mut on_status: F,
) -> Result<Vec<WorkspaceIndexTaskResult>, String>
where
    F: FnMut(WorkspaceIndexTaskStatus) -> Result<(), String>,
{
    let mut results = Vec::new();

    for (task_index, (task, token)) in tasks.iter().enumerate() {
        if is_superseded_by_later_batch_task(&tasks, task_index) {
            results.push(superseded_task_result_from_task(task));
            continue;
        }
        on_status(task_status_from_state_transition(
            task,
            WorkspaceIndexTaskState::Queued,
            WorkspaceIndexTaskState::Running,
            None,
            None,
        )?)?;
        if token.is_cancelled() {
            results.push(superseded_task_result_from_task(task));
            continue;
        }
        let started_at = current_time_millis();
        match run_index_task(index_runtime, task.clone(), token, started_at) {
            Ok(Some(result)) => results.push(result),
            Ok(None) => {}
            Err((task, error)) => results.push(failed_task_result(task, error, started_at)),
        }
    }

    Ok(results)
}

fn is_superseded_by_later_batch_task(
    tasks: &[(WorkspaceIndexTask, WorkspaceIndexCancellationToken)],
    task_index: usize,
) -> bool {
    let task = &tasks[task_index].0;
    tasks.iter().skip(task_index + 1).any(|candidate| {
        candidate.0.root_path == task.root_path
            && candidate.0.generation > task.generation
            && task_kind_replaces_pending(&candidate.0.kind, &task.kind)
    })
}

fn run_index_task(
    index_runtime: &WorkspaceIndexRuntime,
    task: WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    started_at: u128,
) -> Result<Option<WorkspaceIndexTaskResult>, (WorkspaceIndexTask, String)> {
    run_index_task_inner(index_runtime, &task, token, started_at).map_err(|error| (task, error))
}

fn discovery_task_result(
    task: &WorkspaceIndexTask,
    chunk: &WorkspaceDiscoveryChunk,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path.clone(),
        kind: discovery_task_kind_label().to_string(),
        status: if chunk.has_more {
            "partial".to_string()
        } else {
            "ready".to_string()
        },
        reason: task.reason.clone(),
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: Some(format!(
            "Discovered {} file(s), excluded {} entries",
            chunk.files.len(),
            chunk.excluded_count
        )),
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_symbol_count: None,
        progress_current: chunk.files.len(),
        progress_total: if chunk.has_more {
            chunk.files.len().saturating_add(1)
        } else {
            chunk.files.len()
        },
    }
}

fn run_index_task_inner(
    index_runtime: &WorkspaceIndexRuntime,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    started_at: u128,
) -> Result<Option<WorkspaceIndexTaskResult>, String> {
    match task.kind.clone() {
        WorkspaceIndexTaskKind::ChangedPaths => {
            if is_workspace_discovery_task_reason(&task.reason) {
                if token.is_cancelled() {
                    return Ok(Some(superseded_task_result_from_task(task)));
                }
                let cursor = workspace_discovery_task_cursor(task);
                let chunk = run_workspace_discovery_chunk(
                    Path::new(&task.root_path),
                    cursor,
                    WORKSPACE_DISCOVERY_CHUNK_SIZE,
                    task.generation as i64,
                )?;
                return Ok(Some(discovery_task_result(task, &chunk, started_at)));
            }
            if is_full_refresh_continuation(task) {
                if token.is_cancelled() {
                    return Ok(Some(superseded_task_result_from_task(task)));
                }
                let Some(result) = refresh_full_refresh_continuation_chunk(
                    index_runtime,
                    task,
                    token,
                    task.changed_paths.clone(),
                    started_at,
                )?
                else {
                    return Ok(Some(superseded_task_result_from_task(task)));
                };
                return Ok(Some(result));
            }
            let changed_paths = changed_paths_for_task(task)?;
            if token.is_cancelled() {
                return Ok(Some(superseded_task_result_from_task(task)));
            }
            if changed_paths.is_empty() {
                return Ok(Some(skipped_task_result(
                    task,
                    "No changed paths require reindexing",
                    started_at,
                )));
            }
            if is_user_visible_readiness_task(task.priority) {
                let file_symbol_paths = existing_file_paths(&changed_paths);
                if !file_symbol_paths.is_empty() {
                    index_runtime.update_workspace_file_symbol_layer(
                        &task.root_path,
                        &file_symbol_paths,
                        &[],
                    )?;
                }
            }
            if has_graph_affecting_config_change(&changed_paths) {
                mark_dependency_graph_stale(&task.root_path, "config-change")?;
                if token.is_cancelled() {
                    return Ok(Some(superseded_task_result_from_task(task)));
                }
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
            if token.is_cancelled() {
                return Ok(Some(superseded_task_result_from_task(task)));
            }
            let Some(refresh_result) =
                refresh_changed_path_chunks(index_runtime, task, token, changed_paths)?
            else {
                return Ok(Some(superseded_task_result_from_task(task)));
            };
            Ok(Some(refresh_task_result(
                task,
                "changed-paths",
                refresh_result,
                started_at,
            )))
        }
        WorkspaceIndexTaskKind::OpenWorkspace => {
            if token.is_cancelled() {
                return Ok(Some(superseded_task_result_from_task(task)));
            }
            let snapshot = scan_workspace(Path::new(&task.root_path))?;
            let state = index_runtime.index_workspace_snapshot_for_open(&snapshot)?;
            Ok(Some(refresh_task_result(
                task,
                "open-workspace",
                WorkspaceIndexRefreshResult {
                    state,
                    changed: true,
                    added_paths: snapshot.files,
                    removed_paths: Vec::new(),
                },
                started_at,
            )))
        }
        WorkspaceIndexTaskKind::RefreshWorkspace => {
            if token.is_cancelled() {
                return Ok(Some(superseded_task_result_from_task(task)));
            }
            let Some(refresh_outcome) = refresh_workspace_index_in_chunks(
                index_runtime,
                &task.root_path,
                WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE,
                token,
            )?
            else {
                return Ok(Some(superseded_task_result_from_task(task)));
            };
            let mut result = refresh_task_result(
                task,
                "refresh-workspace",
                refresh_outcome.result,
                started_at,
            );
            if let Some(progress) = refresh_outcome.progress {
                result.progress_current = progress.current_chunk;
                result.progress_total = progress.total_chunks;
            }
            if refresh_outcome.continuation.is_some() {
                result.status = "partial".to_string();
                result.message = Some("Full refresh yielded with remaining chunks".to_string());
            }
            result.refresh_continuation = refresh_outcome.continuation;
            Ok(Some(result))
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
            if token.is_cancelled() {
                return Ok(Some(superseded_task_result_from_task(task)));
            }
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
                refresh_continuation: None,
                sdk_symbol_count: Some(summary.symbol_count),
                progress_current: 1,
                progress_total: 1,
            }))
        }
    }
}

fn is_full_refresh_continuation(task: &WorkspaceIndexTask) -> bool {
    is_full_refresh_continuation_reason(&task.reason)
}

fn refresh_full_refresh_continuation_chunk(
    index_runtime: &WorkspaceIndexRuntime,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    changed_paths: Vec<String>,
    started_at: u128,
) -> Result<Option<WorkspaceIndexTaskResult>, String> {
    let mut continuation = plan_refresh_continuation(
        &task.root_path,
        token.generation(),
        changed_paths,
        WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE,
    );
    let Some(chunk) = continuation.pop_next_chunk() else {
        return Ok(None);
    };
    if token.is_cancelled() {
        return Ok(None);
    }
    let state = match continuation_phase(&task.reason) {
        WorkspaceIndexContinuationPhase::FileLayer => {
            index_runtime.update_workspace_file_symbol_layer(&task.root_path, &chunk.paths, &[])?
        }
        WorkspaceIndexContinuationPhase::DeepLayer | WorkspaceIndexContinuationPhase::Legacy => {
            index_runtime.update_workspace_deep_layer(&task.root_path, &chunk.paths, &[])?
        }
    };
    let refresh_result = WorkspaceIndexRefreshResult {
        state,
        changed: !chunk.paths.is_empty(),
        added_paths: chunk.paths,
        removed_paths: Vec::new(),
    };
    let mut result = refresh_task_result(task, "changed-paths", refresh_result, started_at);
    result.progress_current = chunk.progress.current_chunk;
    result.progress_total = chunk.progress.total_chunks;
    if !continuation.is_complete() {
        result.status = "partial".to_string();
        result.message = Some(format!(
            "Full refresh {} continuation yielded",
            continuation_phase_label(&task.reason)
        ));
        result.refresh_continuation = Some(continuation);
    }
    Ok(Some(result))
}

fn refresh_changed_path_chunks(
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
        let result =
            index_runtime.refresh_workspace_index_for_changed_paths(&task.root_path, &chunk)?;
        combined = Some(match combined {
            Some(previous) => combine_refresh_results(previous, result),
            None => result,
        });
    }

    combined
        .map(Some)
        .ok_or_else(|| "No changed path chunks to refresh".to_string())
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

fn changed_paths_for_task(task: &WorkspaceIndexTask) -> Result<Vec<String>, String> {
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

fn is_user_visible_readiness_task(priority: WorkspaceIndexTaskPriority) -> bool {
    matches!(
        priority,
        WorkspaceIndexTaskPriority::ForegroundNavigation
            | WorkspaceIndexTaskPriority::ForegroundCompletion
            | WorkspaceIndexTaskPriority::VisibleFiles
    )
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

fn existing_file_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| Path::new(path.as_str()).is_file())
        .cloned()
        .collect()
}
