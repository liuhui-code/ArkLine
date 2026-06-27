use std::sync::Mutex;

use crate::models::workspace::WorkspaceIndexRefreshResult;
use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, WorkspaceFileFingerprintStatus,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

#[derive(Debug, Default)]
pub struct WorkspaceIndexManagerRuntime {
    scheduler: Mutex<WorkspaceIndexScheduler>,
}

impl WorkspaceIndexManagerRuntime {
    #[allow(dead_code)]
    pub fn open_workspace_index(&self, root_path: &str) -> Result<(), String> {
        self.schedule_workspace_task(
            root_path,
            WorkspaceIndexTaskKind::OpenWorkspace,
            WorkspaceIndexTaskPriority::UserBlocking,
            "open-workspace",
        )
    }

    pub fn refresh_workspace_index(&self, root_path: &str) -> Result<(), String> {
        self.schedule_workspace_task(
            root_path,
            WorkspaceIndexTaskKind::RefreshWorkspace,
            WorkspaceIndexTaskPriority::Normal,
            "refresh-workspace",
        )
    }

    pub fn schedule_changed_paths(
        &self,
        root_path: &str,
        changed_paths: &[String],
    ) -> Result<(), String> {
        if changed_paths.is_empty() {
            return Ok(());
        }

        self.scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .schedule(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind: WorkspaceIndexTaskKind::ChangedPaths,
                priority: WorkspaceIndexTaskPriority::Normal,
                changed_paths: changed_paths.to_vec(),
                generation: 0,
                reason: "watcher".to_string(),
            });
        Ok(())
    }

    fn schedule_workspace_task(
        &self,
        root_path: &str,
        kind: WorkspaceIndexTaskKind,
        priority: WorkspaceIndexTaskPriority,
        reason: &str,
    ) -> Result<(), String> {
        self.scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .schedule(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind,
                priority,
                changed_paths: Vec::new(),
                generation: 0,
                reason: reason.to_string(),
            });
        Ok(())
    }

    pub fn drain_index_tasks(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
    ) -> Result<Vec<WorkspaceIndexRefreshResult>, String> {
        let tasks = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .drain_ready();
        let mut results = Vec::new();

        for task in tasks {
            match task.kind {
                WorkspaceIndexTaskKind::ChangedPaths => {
                    let changed_paths = stale_changed_paths(&task.root_path, &task.changed_paths)?;
                    if changed_paths.is_empty() {
                        continue;
                    }
                    results.push(index_runtime.refresh_workspace_index_for_changed_paths(
                        &task.root_path,
                        &changed_paths,
                    )?);
                }
                WorkspaceIndexTaskKind::OpenWorkspace
                | WorkspaceIndexTaskKind::RefreshWorkspace => {
                    results
                        .push(index_runtime.refresh_workspace_index_with_changes(&task.root_path)?);
                }
                WorkspaceIndexTaskKind::IndexSdk => {}
            }
        }

        Ok(results)
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
