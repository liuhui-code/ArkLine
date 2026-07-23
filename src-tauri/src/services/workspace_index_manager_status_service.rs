use std::sync::{Arc, Mutex};

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTaskStatus};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask,
};
use crate::services::workspace_index_state_machine_service::{
    should_publish_task_result, task_state_label, WorkspaceIndexTaskState,
};
use crate::services::workspace_index_task_journal_service::{
    store_task_status, store_task_status_with_events, store_task_statuses_with_events,
};
use crate::services::workspace_index_task_lifecycle_service::task_supersedes_result;
use crate::services::workspace_index_task_status_service::{
    superseded_task_result, task_status_from_state_transition, task_status_from_task,
    WorkspaceIndexTaskResult,
};

pub(crate) fn store_recent_status(
    recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    status: WorkspaceIndexTaskStatus,
) -> Result<Vec<WorkspaceIndexEvent>, String> {
    {
        let mut statuses = recent_statuses
            .lock()
            .map_err(|_| "Workspace index status lock poisoned".to_string())?;
        statuses.retain(|existing| existing.task_id != status.task_id);
        statuses.push(status.clone());
        statuses.sort_by(|left, right| left.generation.cmp(&right.generation));
        if statuses.len() > 32 {
            let overflow = statuses.len() - 32;
            statuses.drain(0..overflow);
        }
    }
    store_task_status_with_events(&status.root_path, &status)
}

pub(crate) fn store_recent_statuses(
    recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    statuses: &[WorkspaceIndexTaskStatus],
) -> Result<Vec<Vec<WorkspaceIndexEvent>>, String> {
    let Some(first) = statuses.first() else {
        return Ok(Vec::new());
    };
    {
        let mut recent = recent_statuses
            .lock()
            .map_err(|_| "Workspace index status lock poisoned".to_string())?;
        for status in statuses {
            recent.retain(|existing| existing.task_id != status.task_id);
            recent.push(status.clone());
        }
        recent.sort_by(|left, right| left.generation.cmp(&right.generation));
        if recent.len() > 32 {
            let overflow = recent.len() - 32;
            recent.drain(0..overflow);
        }
    }
    store_task_statuses_with_events(&first.root_path, statuses)
}

pub(crate) fn store_pending_statuses_for_root(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    root_path: &str,
) -> Result<(), String> {
    let tasks = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
        .pending_tasks_for_root(root_path);
    for task in tasks {
        store_task_status(
            root_path,
            &task_status_from_task(
                &task,
                task_state_label(WorkspaceIndexTaskState::Queued),
                None,
                None,
            ),
        )?;
    }
    Ok(())
}

pub(crate) fn store_cancelled_statuses(
    recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    tasks: Vec<WorkspaceIndexTask>,
) -> Result<(), String> {
    store_transition_statuses(recent_statuses, tasks, WorkspaceIndexTaskState::Cancelled)
}

pub(crate) fn store_superseded_statuses(
    recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    tasks: Vec<WorkspaceIndexTask>,
) -> Result<(), String> {
    store_transition_statuses(recent_statuses, tasks, WorkspaceIndexTaskState::Superseded)
}

pub(crate) fn mark_superseded_results(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: Vec<WorkspaceIndexTaskResult>,
) -> Result<Vec<WorkspaceIndexTaskResult>, String> {
    results
        .into_iter()
        .map(|result| {
            if has_newer_pending_task(scheduler, &result)? {
                Ok(superseded_task_result(result))
            } else {
                Ok(result)
            }
        })
        .collect()
}

fn store_transition_statuses(
    recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    tasks: Vec<WorkspaceIndexTask>,
    target_state: WorkspaceIndexTaskState,
) -> Result<(), String> {
    for task in tasks {
        store_recent_status(
            recent_statuses,
            task_status_from_state_transition(
                &task,
                WorkspaceIndexTaskState::Queued,
                target_state,
                None,
                Some("Replaced by a newer index task".to_string()),
            )?,
        )?;
    }
    Ok(())
}

fn has_newer_pending_task(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    result: &WorkspaceIndexTaskResult,
) -> Result<bool, String> {
    Ok(scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
        .pending_tasks_for_root(&result.root_path)
        .iter()
        .any(|task| {
            !should_publish_task_result(result.generation, task.generation)
                && task_supersedes_result(task, &result.kind, &result.reason)
        }))
}
