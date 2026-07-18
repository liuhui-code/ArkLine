use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread;
use std::time::Duration;

use crate::indexer_host::{IndexerHostRuntime, IndexerHostSnapshot};
use crate::models::workspace::{
    WorkspaceIndexEvent, WorkspaceIndexQueuePressure, WorkspaceIndexRefreshResult,
    WorkspaceIndexTaskStatus,
};
use crate::services::workspace_index_cancellation_service::{
    cancel_active_tasks_superseded_by_latest, finish_cancellable_tasks, start_cancellable_tasks,
    WorkspaceIndexCancellationRegistry,
};
use crate::services::workspace_index_follow_up_task_service::schedule_index_follow_up_tasks;
use crate::services::workspace_index_manager_status_service::{
    mark_superseded_results, store_cancelled_statuses, store_pending_statuses_for_root,
    store_recent_status, store_superseded_statuses,
};
use crate::services::workspace_index_queue_pressure_service::project_queue_pressure;
use crate::services::workspace_index_resume_service::{
    clear_completed_resume_tasks, schedule_resume_tasks_from_store,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_state_machine_service::{
    task_state_label, WorkspaceIndexTaskState,
};
use crate::services::workspace_index_status_projection_service::{
    is_terminal_task_status, project_task_statuses,
};
use crate::services::workspace_index_task_journal_service::load_recent_task_statuses;
use crate::services::workspace_index_task_status_service::{
    current_time_millis, task_status_from_publishable_result, task_status_from_task,
    WorkspaceIndexTaskResult,
};
use crate::services::workspace_index_worker_service::run_index_tasks_with_cancellation_and_ui_activity_and_indexer;

const BACKGROUND_WORKER_IDLE_RETIRE_MS: u64 = 30_000;
pub const WORKSPACE_INDEX_WORKER_TASK_BATCH_SIZE: usize = 8;
#[derive(Debug, Default, Clone)]
pub struct WorkspaceIndexManagerRuntime {
    scheduler: Arc<Mutex<WorkspaceIndexScheduler>>,
    cancellations: Arc<Mutex<WorkspaceIndexCancellationRegistry>>,
    recent_statuses: Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    worker_running: Arc<AtomicBool>,
    worker_signal: Arc<(Mutex<u64>, Condvar)>,
    indexer: Arc<IndexerHostRuntime>,
}
impl WorkspaceIndexManagerRuntime {
    #[allow(dead_code)]
    pub fn indexer_snapshot(&self) -> IndexerHostSnapshot {
        self.indexer.snapshot()
    }

    #[allow(dead_code)]
    pub fn open_workspace_index(&self, root_path: &str) -> Result<(), String> {
        self.schedule_workspace_task(
            root_path,
            WorkspaceIndexTaskKind::OpenWorkspace,
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            "open-workspace",
        )?;
        let summary = schedule_resume_tasks_from_store(&self.scheduler, root_path)?;
        store_superseded_statuses(&self.recent_statuses, summary.superseded_tasks)?;
        for root_path in summary.root_paths {
            store_pending_statuses_for_root(&self.scheduler, &root_path)?;
        }
        Ok(())
    }

    pub fn refresh_workspace_index(&self, root_path: &str) -> Result<(), String> {
        self.schedule_workspace_task(
            root_path,
            WorkspaceIndexTaskKind::RefreshWorkspace,
            WorkspaceIndexTaskPriority::FullRefresh,
            "refresh-workspace",
        )
    }

    pub fn schedule_changed_paths(
        &self,
        root_path: &str,
        changed_paths: &[String],
    ) -> Result<(), String> {
        self.schedule_changed_path_task(
            root_path,
            changed_paths,
            WorkspaceIndexTaskPriority::ChangedFiles,
            "watcher",
        )
    }

    pub(crate) fn schedule_changed_path_task(
        &self,
        root_path: &str,
        changed_paths: &[String],
        priority: WorkspaceIndexTaskPriority,
        reason: &str,
    ) -> Result<(), String> {
        if changed_paths.is_empty() {
            return Ok(());
        }

        let schedule_result = {
            self.scheduler
                .lock()
                .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
                .schedule_with_result(WorkspaceIndexTask {
                    root_path: root_path.to_string(),
                    kind: WorkspaceIndexTaskKind::ChangedPaths,
                    priority,
                    changed_paths: changed_paths.to_vec(),
                    sdk_path: None,
                    sdk_version: None,
                    generation: 0,
                    reason: reason.to_string(),
                })
        };
        if !schedule_result.scheduled {
            return Ok(());
        }
        cancel_active_tasks_superseded_by_latest(
            &self.cancellations,
            &self.scheduler,
            root_path,
            WorkspaceIndexTaskKind::ChangedPaths,
        )?;
        store_superseded_statuses(&self.recent_statuses, schedule_result.superseded_tasks)?;
        store_pending_statuses_for_root(&self.scheduler, root_path)?;
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
                priority: WorkspaceIndexTaskPriority::SdkIndexing,
                changed_paths: Vec::new(),
                sdk_path: Some(sdk_path.to_string()),
                sdk_version: Some(sdk_version.to_string()),
                generation: 0,
                reason: "sdk-apply".to_string(),
            });
        cancel_active_tasks_superseded_by_latest(
            &self.cancellations,
            &self.scheduler,
            root_path,
            WorkspaceIndexTaskKind::IndexSdk,
        )?;
        store_cancelled_statuses(&self.recent_statuses, cancelled)?;
        store_pending_statuses_for_root(&self.scheduler, root_path)?;
        self.wake_background_worker()?;
        Ok(())
    }

    pub fn get_index_task_statuses(
        &self,
        root_path: &str,
    ) -> Result<Vec<WorkspaceIndexTaskStatus>, String> {
        let mut statuses = load_recent_task_statuses(root_path, 32)?
            .into_iter()
            .filter(|status| is_terminal_task_status(&status.status))
            .collect::<Vec<_>>();
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
                .map(|task| {
                    task_status_from_task(
                        &task,
                        task_state_label(WorkspaceIndexTaskState::Queued),
                        None,
                        None,
                    )
                }),
        );
        Ok(project_task_statuses(statuses, current_time_millis()))
    }

    #[allow(dead_code)]
    pub fn get_queue_pressure(
        &self,
        root_path: &str,
    ) -> Result<WorkspaceIndexQueuePressure, String> {
        let tasks = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .pending_tasks();
        Ok(project_queue_pressure(root_path, &tasks))
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
                    kind: kind.clone(),
                    priority,
                    changed_paths: Vec::new(),
                    sdk_path: None,
                    sdk_version: None,
                    generation: 0,
                    reason: reason.to_string(),
                })
        };
        cancel_active_tasks_superseded_by_latest(
            &self.cancellations,
            &self.scheduler,
            root_path,
            kind,
        )?;
        store_superseded_statuses(&self.recent_statuses, superseded)?;
        store_pending_statuses_for_root(&self.scheduler, root_path)?;
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
        self.run_index_worker_once_with_events(index_runtime, |status, _events| on_status(status))
    }

    pub fn run_index_worker_once_with_events<F>(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
        on_status: F,
    ) -> Result<Vec<WorkspaceIndexTaskResult>, String>
    where
        F: FnMut(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>),
    {
        self.run_index_worker_once_with_events_and_ui_activity(index_runtime, on_status, || false)
    }

    pub fn run_index_worker_once_with_events_and_ui_activity<F, G>(
        &self,
        index_runtime: &WorkspaceIndexRuntime,
        mut on_status: F,
        is_ui_latency_sensitive: G,
    ) -> Result<Vec<WorkspaceIndexTaskResult>, String>
    where
        F: FnMut(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>),
        G: FnMut() -> bool,
    {
        let tasks = self
            .scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .drain_ready_batch(WORKSPACE_INDEX_WORKER_TASK_BATCH_SIZE);
        let (guarded_tasks, tokens) = start_cancellable_tasks(&self.cancellations, tasks)?;
        let results = run_index_tasks_with_cancellation_and_ui_activity_and_indexer(
            index_runtime,
            guarded_tasks,
            |running_status| {
                let events = store_recent_status(&self.recent_statuses, running_status.clone())?;
                on_status(running_status, events);
                Ok::<(), String>(())
            },
            is_ui_latency_sensitive,
            Some(self.indexer.as_ref()),
        );
        finish_cancellable_tasks(&self.cancellations, &tokens)?;
        let results = results?;
        let results = mark_superseded_results(&self.scheduler, results)?;
        clear_completed_resume_tasks(&results)?;
        let continuation_summary = schedule_index_follow_up_tasks(&self.scheduler, &results)?;
        store_superseded_statuses(&self.recent_statuses, continuation_summary.superseded_tasks)?;
        for root_path in continuation_summary.root_paths {
            store_pending_statuses_for_root(&self.scheduler, &root_path)?;
        }

        for result in &results {
            let ready_status = task_status_from_publishable_result(result)?;
            let events = store_recent_status(&self.recent_statuses, ready_status.clone())?;
            on_status(ready_status, events);
        }

        Ok(results)
    }

    pub fn start_background_worker_with_events<F>(
        &self,
        index_runtime: WorkspaceIndexRuntime,
        on_status: F,
    ) -> Result<bool, String>
    where
        F: Fn(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>) + Send + 'static,
    {
        self.start_background_worker_with_events_and_ui_activity(index_runtime, on_status, || false)
    }

    pub fn start_background_worker_with_events_and_ui_activity<F, G>(
        &self,
        index_runtime: WorkspaceIndexRuntime,
        on_status: F,
        mut is_ui_latency_sensitive: G,
    ) -> Result<bool, String>
    where
        F: Fn(WorkspaceIndexTaskStatus, Vec<WorkspaceIndexEvent>) + Send + 'static,
        G: FnMut() -> bool + Send + 'static,
    {
        if self.worker_running.swap(true, Ordering::SeqCst) {
            return Ok(false);
        }

        let manager = self.clone();
        thread::Builder::new()
            .name("arkline-index-manager".to_string())
            .spawn(move || {
                loop {
                    let _ = manager.run_index_worker_once_with_events_and_ui_activity(
                        &index_runtime,
                        |status, events| on_status(status, events),
                        &mut is_ui_latency_sensitive,
                    );
                    if !manager.has_pending_tasks() && manager.wait_for_worker_wake_timed_out() {
                        break;
                    }
                }
                manager.worker_running.store(false, Ordering::SeqCst);
            })
            .map_err(|error| {
                self.worker_running.store(false, Ordering::SeqCst);
                format!("Failed to start index manager worker: {error}")
            })?;
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
                Duration::from_millis(BACKGROUND_WORKER_IDLE_RETIRE_MS),
                |current_generation| *current_generation == observed_generation,
            )
            .map(|(_, timeout)| timeout.timed_out())
            .unwrap_or(true)
    }
}
