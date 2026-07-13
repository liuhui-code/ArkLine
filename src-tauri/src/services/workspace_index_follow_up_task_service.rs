use std::sync::{Arc, Mutex};

use crate::services::workspace_discovery_store_service::load_discovery_cursor;
use crate::services::workspace_discovery_task_service::{
    discovery_task_kind_label, workspace_discovery_task, workspace_discovery_task_with_cursor,
};
use crate::services::workspace_index_continuation_task_service::schedule_refresh_continuations;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexFollowUpScheduleSummary {
    pub root_paths: Vec<String>,
    pub superseded_tasks: Vec<WorkspaceIndexTask>,
}

pub fn schedule_index_follow_up_tasks(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
) -> Result<WorkspaceIndexFollowUpScheduleSummary, String> {
    let mut summary = WorkspaceIndexFollowUpScheduleSummary::default();
    let continuation_summary = schedule_refresh_continuations(scheduler, results)?;
    summary.root_paths.extend(continuation_summary.root_paths);
    summary
        .superseded_tasks
        .extend(continuation_summary.superseded_tasks);
    schedule_discovery_tasks(scheduler, results, &mut summary)?;
    schedule_refresh_after_discovery_tasks(scheduler, results, &mut summary)?;
    schedule_sdk_continuation_tasks(scheduler, results, &mut summary)?;
    summary.root_paths.sort();
    summary.root_paths.dedup();
    Ok(summary)
}

fn schedule_discovery_tasks(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
    summary: &mut WorkspaceIndexFollowUpScheduleSummary,
) -> Result<(), String> {
    let tasks = discovery_follow_up_tasks(results)?;
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;
    for task in tasks {
        push_schedule_summary(&mut scheduler, task, summary);
    }
    Ok(())
}

fn schedule_refresh_after_discovery_tasks(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
    summary: &mut WorkspaceIndexFollowUpScheduleSummary,
) -> Result<(), String> {
    let tasks = results
        .iter()
        .filter(|result| should_schedule_refresh_after_discovery(result))
        .map(|result| background_refresh_after_open_task(&result.root_path))
        .collect::<Vec<_>>();
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;
    for task in tasks {
        push_schedule_summary(&mut scheduler, task, summary);
    }
    Ok(())
}

fn schedule_sdk_continuation_tasks(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
    summary: &mut WorkspaceIndexFollowUpScheduleSummary,
) -> Result<(), String> {
    let tasks = results.iter().filter_map(sdk_continuation_task);
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;
    for task in tasks {
        push_schedule_summary(&mut scheduler, task, summary);
    }
    Ok(())
}

fn push_schedule_summary(
    scheduler: &mut WorkspaceIndexScheduler,
    task: WorkspaceIndexTask,
    summary: &mut WorkspaceIndexFollowUpScheduleSummary,
) {
    let root_path = task.root_path.clone();
    let result = scheduler.schedule_with_result(task);
    if result.scheduled {
        summary.root_paths.push(root_path);
        summary.superseded_tasks.extend(result.superseded_tasks);
    }
}

fn sdk_continuation_task(result: &WorkspaceIndexTaskResult) -> Option<WorkspaceIndexTask> {
    if result.kind != "sdk" || result.status != "partial" || result.error.is_some() {
        return None;
    }
    if result.sdk_remaining_files.is_empty() {
        return None;
    }
    Some(WorkspaceIndexTask {
        root_path: result.root_path.clone(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::SdkIndexing,
        changed_paths: result.sdk_remaining_files.clone(),
        sdk_path: result.sdk_path.clone(),
        sdk_version: result.sdk_version.clone(),
        generation: 0,
        reason: result.reason.clone(),
    })
}

fn discovery_follow_up_tasks(
    results: &[WorkspaceIndexTaskResult],
) -> Result<Vec<WorkspaceIndexTask>, String> {
    let mut tasks = Vec::new();
    for result in results {
        if let Some(task) = discovery_follow_up_task(result)? {
            tasks.push(task);
        }
    }
    Ok(tasks)
}

fn discovery_follow_up_task(
    result: &WorkspaceIndexTaskResult,
) -> Result<Option<WorkspaceIndexTask>, String> {
    if should_schedule_initial_discovery(result) {
        return Ok(Some(workspace_discovery_task(&result.root_path, 0)));
    }
    if !should_continue_discovery(result) {
        return Ok(None);
    }
    let cursor = load_discovery_cursor(&result.root_path)?;
    Ok(cursor.map(|cursor| {
        workspace_discovery_task_with_cursor(&result.root_path, result.generation, Some(cursor))
    }))
}

fn should_schedule_initial_discovery(result: &WorkspaceIndexTaskResult) -> bool {
    result.kind == "open-workspace" && result.error.is_none() && result.status != "superseded"
}

fn should_continue_discovery(result: &WorkspaceIndexTaskResult) -> bool {
    result.kind == discovery_task_kind_label()
        && result.status == "partial"
        && result.error.is_none()
}

fn should_schedule_refresh_after_discovery(result: &WorkspaceIndexTaskResult) -> bool {
    result.kind == discovery_task_kind_label() && result.status == "ready" && result.error.is_none()
}

fn background_refresh_after_open_task(root_path: &str) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority: WorkspaceIndexTaskPriority::FullRefresh,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "background-refresh-after-open".to_string(),
    }
}
