use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread;
use std::time::Duration;

use crate::models::workspace::{WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_journal_service::{
    load_recent_task_statuses, store_task_status,
};
use crate::services::workspace_index_task_lifecycle_service::task_kind_supersedes_result;
use crate::services::workspace_index_task_status_service::{
    superseded_task_result, task_status_from_result, task_status_from_task,
    WorkspaceIndexTaskResult,
};
use crate::services::workspace_index_worker_service::run_index_tasks;

const BACKGROUND_WORKER_IDLE_TIMEOUT_MS: u64 = 250;

#[derive(Debug, Default, Clone)]
pub struct WorkspaceIndexManagerRuntime {
    scheduler: Arc<Mutex<WorkspaceIndexScheduler>>,
    recent_statuses: Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    worker_running: Arc<AtomicBool>,
    worker_signal: Arc<(Mutex<u64>, Condvar)>,
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

        let superseded = {
            self.scheduler
                .lock()
                .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
                .schedule(WorkspaceIndexTask {
                    root_path: root_path.to_string(),
                    kind: WorkspaceIndexTaskKind::ChangedPaths,
                    priority: WorkspaceIndexTaskPriority::Normal,
                    changed_paths: changed_paths.to_vec(),
                    sdk_path: None,
                    sdk_version: None,
                    generation: 0,
                    reason: "watcher".to_string(),
                })
        };
        self.store_superseded_statuses(superseded)?;
        self.store_pending_statuses_for_root(root_path)?;
        self.wake_background_worker()?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn schedule_sdk_index(
        &self,
        root_path: &str,
        sdk_path: &str,
        sdk_version: &str,
    ) -> Result<(), String> {
        let cancelled = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .schedule(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind: WorkspaceIndexTaskKind::IndexSdk,
                priority: WorkspaceIndexTaskPriority::Normal,
                changed_paths: Vec::new(),
                sdk_path: Some(sdk_path.to_string()),
                sdk_version: Some(sdk_version.to_string()),
                generation: 0,
                reason: "sdk-apply".to_string(),
            });
        self.store_cancelled_statuses(cancelled)?;
        self.store_pending_statuses_for_root(root_path)?;
        self.wake_background_worker()?;
        Ok(())
    }

    pub fn get_index_task_statuses(
        &self,
        root_path: &str,
    ) -> Result<Vec<WorkspaceIndexTaskStatus>, String> {
        let mut statuses = load_recent_task_statuses(root_path, 32)?;
        statuses.extend(
            self.recent_statuses
                .lock()
                .map_err(|_| "Workspace index status lock poisoned".to_string())?
                .iter()
                .filter(|status| status.root_path == root_path)
                .cloned()
                .collect::<Vec<_>>(),
        );

        statuses.extend(
            self.scheduler
                .lock()
                .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
                .pending_tasks_for_root(root_path)
                .into_iter()
                .map(|task| task_status_from_task(&task, "queued", None, None)),
        );
        Ok(merge_task_statuses(statuses))
    }

    fn schedule_workspace_task(
        &self,
        root_path: &str,
        kind: WorkspaceIndexTaskKind,
        priority: WorkspaceIndexTaskPriority,
        reason: &str,
    ) -> Result<(), String> {
        let superseded = {
            self.scheduler
                .lock()
                .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
                .schedule(WorkspaceIndexTask {
                    root_path: root_path.to_string(),
                    kind,
                    priority,
                    changed_paths: Vec::new(),
                    sdk_path: None,
                    sdk_version: None,
                    generation: 0,
                    reason: reason.to_string(),
                })
        };
        self.store_superseded_statuses(superseded)?;
        self.store_pending_statuses_for_root(root_path)?;
        self.wake_background_worker()?;
        Ok(())
    }

    pub fn drain_index_tasks(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
    ) -> Result<Vec<WorkspaceIndexRefreshResult>, String> {
        Ok(self
            .drain_index_task_results(index_runtime)?
            .into_iter()
            .filter_map(|result| result.refresh_result)
            .collect())
    }

    pub fn drain_index_task_results(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
    ) -> Result<Vec<WorkspaceIndexTaskResult>, String> {
        self.run_index_worker_once(index_runtime, |_| {})
    }

    pub fn run_index_worker_once<F>(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
        mut on_status: F,
    ) -> Result<Vec<WorkspaceIndexTaskResult>, String>
    where
        F: FnMut(WorkspaceIndexTaskStatus),
    {
        let tasks = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .drain_ready();
        let results = run_index_tasks(index_runtime, tasks, |running_status| {
            self.store_recent_status(running_status.clone())?;
            on_status(running_status);
            Ok::<(), String>(())
        })?;
        let results = self.mark_superseded_results(results)?;

        for result in &results {
            let ready_status = task_status_from_result(result);
            self.store_recent_status(ready_status.clone())?;
            on_status(ready_status);
        }

        Ok(results)
    }

    pub fn start_background_worker<F>(
        &self,
        index_runtime: WorkspaceIndexRuntime,
        on_status: F,
    ) -> Result<bool, String>
    where
        F: Fn(WorkspaceIndexTaskStatus) + Send + 'static,
    {
        if self.worker_running.swap(true, Ordering::SeqCst) {
            return Ok(false);
        }

        let manager = self.clone();
        thread::spawn(move || {
            loop {
                let _ = manager.run_index_worker_once(&index_runtime, |status| on_status(status));
                if !manager.has_pending_tasks() && manager.wait_for_worker_wake_timed_out() {
                    break;
                }
            }
            manager.worker_running.store(false, Ordering::SeqCst);
        });
        Ok(true)
    }

    fn has_pending_tasks(&self) -> bool {
        self.scheduler
            .lock()
            .map(|scheduler| scheduler.has_pending_tasks())
            .unwrap_or(false)
    }

    fn wake_background_worker(&self) -> Result<(), String> {
        let (signal_lock, signal) = &*self.worker_signal;
        let mut generation = signal_lock
            .lock()
            .map_err(|_| "Workspace index worker signal lock poisoned".to_string())?;
        *generation += 1;
        signal.notify_one();
        Ok(())
    }

    fn wait_for_worker_wake_timed_out(&self) -> bool {
        let (signal_lock, signal) = &*self.worker_signal;
        let Ok(generation) = signal_lock.lock() else {
            return true;
        };
        let observed_generation = *generation;
        signal
            .wait_timeout_while(
                generation,
                Duration::from_millis(BACKGROUND_WORKER_IDLE_TIMEOUT_MS),
                |current_generation| *current_generation == observed_generation,
            )
            .map(|(_, timeout)| timeout.timed_out())
            .unwrap_or(true)
    }

    fn store_recent_status(&self, status: WorkspaceIndexTaskStatus) -> Result<(), String> {
        {
            let mut statuses = self
                .recent_statuses
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
        store_task_status(&status.root_path, &status)
    }

    fn store_pending_statuses_for_root(&self, root_path: &str) -> Result<(), String> {
        let tasks = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .pending_tasks_for_root(root_path);
        for task in tasks {
            store_task_status(
                root_path,
                &task_status_from_task(&task, "queued", None, None),
            )?;
        }
        Ok(())
    }

    fn store_cancelled_statuses(&self, tasks: Vec<WorkspaceIndexTask>) -> Result<(), String> {
        for task in tasks {
            self.store_recent_status(task_status_from_task(
                &task,
                "cancelled",
                None,
                Some("Replaced by a newer index task".to_string()),
            ))?;
        }
        Ok(())
    }

    fn store_superseded_statuses(&self, tasks: Vec<WorkspaceIndexTask>) -> Result<(), String> {
        for task in tasks {
            self.store_recent_status(task_status_from_task(
                &task,
                "superseded",
                None,
                Some("Replaced by a newer index task".to_string()),
            ))?;
        }
        Ok(())
    }

    fn mark_superseded_results(
        &self,
        results: Vec<WorkspaceIndexTaskResult>,
    ) -> Result<Vec<WorkspaceIndexTaskResult>, String> {
        results
            .into_iter()
            .map(|result| {
                if self.has_newer_pending_task(&result)? {
                    Ok(superseded_task_result(result))
                } else {
                    Ok(result)
                }
            })
            .collect()
    }

    fn has_newer_pending_task(&self, result: &WorkspaceIndexTaskResult) -> Result<bool, String> {
        Ok(self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .pending_tasks_for_root(&result.root_path)
            .iter()
            .any(|task| {
                task.generation > result.generation
                    && task_kind_supersedes_result(&task.kind, &result.kind)
            }))
    }
}

fn merge_task_statuses(statuses: Vec<WorkspaceIndexTaskStatus>) -> Vec<WorkspaceIndexTaskStatus> {
    let mut by_task_id = HashMap::new();
    for status in statuses {
        by_task_id.insert(status.task_id.clone(), status);
    }
    let mut merged = by_task_id.into_values().collect::<Vec<_>>();
    merged.sort_by(|left, right| left.generation.cmp(&right.generation));
    merged
}
