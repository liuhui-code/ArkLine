use crate::services::workspace_index_chunk_service::WorkspaceIndexRefreshContinuation;
use crate::services::workspace_index_resume_service::save_resume_task;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;
use std::sync::{Arc, Mutex};

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
    continuation
        .next_chunk_paths()
        .map(|paths| WorkspaceIndexTask {
            root_path: continuation.root_path.clone(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: paths
                .into_iter()
                .map(|path| path.as_ref().to_string())
                .collect(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: format!("full-refresh-continuation:{reason}"),
        })
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
        let Some(continuation) = result.refresh_continuation.as_ref() else {
            continue;
        };
        let Some(task) = next_refresh_continuation_task(continuation, &result.kind) else {
            continue;
        };
        save_resume_task(&task.root_path, &task)?;
        root_paths.push(task.root_path.clone());
        superseded_tasks.extend(scheduler.schedule(task));
    }
    root_paths.sort();
    root_paths.dedup();
    Ok(WorkspaceIndexContinuationScheduleSummary {
        root_paths,
        superseded_tasks,
    })
}
