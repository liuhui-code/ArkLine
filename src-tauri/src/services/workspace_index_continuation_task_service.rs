use crate::services::workspace_index_chunk_service::WorkspaceIndexRefreshContinuation;
use crate::services::workspace_index_resume_service::save_resume_task;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;
use std::sync::{Arc, Mutex};

const LEGACY_FULL_REFRESH_PREFIX: &str = "full-refresh-continuation:";
const FILE_LAYER_FULL_REFRESH_PREFIX: &str = "full-refresh-files:";
const DEEP_LAYER_FULL_REFRESH_PREFIX: &str = "full-refresh-deep:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexContinuationPhase {
    FileLayer,
    DeepLayer,
    Legacy,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexContinuationScheduleSummary {
    pub root_paths: Vec<String>,
    pub superseded_tasks: Vec<WorkspaceIndexTask>,
}

#[allow(dead_code)]
pub fn next_refresh_continuation_task<T>(
    continuation: &WorkspaceIndexRefreshContinuation<T>,
    reason: &str,
) -> Option<WorkspaceIndexTask>
where
    T: AsRef<str> + Clone,
{
    let paths = continuation.remaining_paths();
    if paths.is_empty() {
        None
    } else {
        let phase = continuation_phase(reason);
        Some(WorkspaceIndexTask {
            root_path: continuation.root_path.clone(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: continuation_priority(phase),
            changed_paths: paths
                .into_iter()
                .map(|path| path.as_ref().to_string())
                .collect(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: continuation_reason(reason),
        })
    }
}

pub fn is_full_refresh_continuation_reason(reason: &str) -> bool {
    reason.starts_with(LEGACY_FULL_REFRESH_PREFIX)
        || reason.starts_with(FILE_LAYER_FULL_REFRESH_PREFIX)
        || reason.starts_with(DEEP_LAYER_FULL_REFRESH_PREFIX)
}

pub fn continuation_phase(reason: &str) -> WorkspaceIndexContinuationPhase {
    if reason.starts_with(DEEP_LAYER_FULL_REFRESH_PREFIX) {
        WorkspaceIndexContinuationPhase::DeepLayer
    } else if reason.starts_with(LEGACY_FULL_REFRESH_PREFIX) {
        WorkspaceIndexContinuationPhase::Legacy
    } else {
        WorkspaceIndexContinuationPhase::FileLayer
    }
}

pub fn continuation_phase_label(reason: &str) -> &'static str {
    match continuation_phase(reason) {
        WorkspaceIndexContinuationPhase::FileLayer => "file-layer",
        WorkspaceIndexContinuationPhase::DeepLayer => "deep-layer",
        WorkspaceIndexContinuationPhase::Legacy => "legacy",
    }
}

fn continuation_priority(phase: WorkspaceIndexContinuationPhase) -> WorkspaceIndexTaskPriority {
    match phase {
        WorkspaceIndexContinuationPhase::DeepLayer => WorkspaceIndexTaskPriority::Background,
        WorkspaceIndexContinuationPhase::FileLayer | WorkspaceIndexContinuationPhase::Legacy => {
            WorkspaceIndexTaskPriority::FullRefresh
        }
    }
}

fn continuation_reason(reason: &str) -> String {
    if is_full_refresh_continuation_reason(reason) {
        reason.to_string()
    } else {
        format!("{FILE_LAYER_FULL_REFRESH_PREFIX}{reason}")
    }
}

pub fn schedule_refresh_continuations(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
) -> Result<WorkspaceIndexContinuationScheduleSummary, String> {
    let mut root_paths = Vec::new();
    let mut superseded_tasks = Vec::new();
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;

    for result in results {
        if let Some(continuation) = result.refresh_continuation.as_ref() {
            if let Some(task) = next_refresh_continuation_task(continuation, &result.reason) {
                root_paths.push(task.root_path.clone());
                superseded_tasks.extend(schedule_and_save(&mut scheduler, task)?);
            }
        }
        if let Some(task) = next_deep_refresh_task(result) {
            root_paths.push(task.root_path.clone());
            superseded_tasks.extend(schedule_and_save(&mut scheduler, task)?);
        }
    }
    root_paths.sort();
    root_paths.dedup();
    Ok(WorkspaceIndexContinuationScheduleSummary {
        root_paths,
        superseded_tasks,
    })
}

fn schedule_and_save(
    scheduler: &mut WorkspaceIndexScheduler,
    task: WorkspaceIndexTask,
) -> Result<Vec<WorkspaceIndexTask>, String> {
    let root_path = task.root_path.clone();
    let reason = task.reason.clone();
    let kind = task.kind.clone();
    let schedule_result = scheduler.schedule_with_result(task);
    if !schedule_result.scheduled {
        return Ok(Vec::new());
    }
    if let Some(pending) = scheduler
        .pending_tasks_for_root(&root_path)
        .into_iter()
        .find(|pending| pending.kind == kind && pending.reason == reason)
    {
        save_resume_task(&pending.root_path, &pending)?;
    }
    Ok(schedule_result.superseded_tasks)
}

fn next_deep_refresh_task(result: &WorkspaceIndexTaskResult) -> Option<WorkspaceIndexTask> {
    if !should_schedule_deep_refresh(result) {
        return None;
    }
    let mut paths = result.refresh_result.as_ref()?.added_paths.clone();
    paths.sort();
    paths.dedup();
    if paths.is_empty() {
        return None;
    }
    Some(WorkspaceIndexTask {
        root_path: result.root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths: paths,
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: deep_continuation_reason(&result.reason),
    })
}

fn should_schedule_deep_refresh(result: &WorkspaceIndexTaskResult) -> bool {
    result.error.is_none()
        && result.refresh_result.is_some()
        && (result.reason == "refresh-workspace"
            || continuation_phase(&result.reason) == WorkspaceIndexContinuationPhase::FileLayer)
}

fn deep_continuation_reason(reason: &str) -> String {
    if reason.starts_with(DEEP_LAYER_FULL_REFRESH_PREFIX) {
        reason.to_string()
    } else if let Some(base) = reason.strip_prefix(FILE_LAYER_FULL_REFRESH_PREFIX) {
        format!("{DEEP_LAYER_FULL_REFRESH_PREFIX}{base}")
    } else {
        format!("{DEEP_LAYER_FULL_REFRESH_PREFIX}{reason}")
    }
}
