use std::collections::VecDeque;

use crate::services::workspace_discovery_task_service::is_workspace_discovery_task_reason;
use crate::services::workspace_index_task_lifecycle_service::task_kind_replaces_pending;

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceIndexTaskKind {
    OpenWorkspace,
    RefreshWorkspace,
    ChangedPaths,
    IndexSdk,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WorkspaceIndexTaskPriority {
    Background,
    SdkIndexing,
    FullRefresh,
    ChangedFiles,
    VisibleFiles,
    Normal,
    UserBlocking,
    ForegroundCompletion,
    ForegroundNavigation,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexTask {
    pub root_path: String,
    pub kind: WorkspaceIndexTaskKind,
    pub priority: WorkspaceIndexTaskPriority,
    pub changed_paths: Vec<String>,
    pub sdk_path: Option<String>,
    pub sdk_version: Option<String>,
    pub generation: u64,
    pub reason: String,
}

#[allow(dead_code)]
#[derive(Debug, Default)]
pub struct WorkspaceIndexScheduler {
    generation: u64,
    tasks: VecDeque<WorkspaceIndexTask>,
}

#[derive(Debug, Default)]
pub struct WorkspaceIndexScheduleResult {
    pub superseded_tasks: Vec<WorkspaceIndexTask>,
    pub scheduled: bool,
}

impl WorkspaceIndexScheduler {
    #[allow(dead_code)]
    pub fn schedule(&mut self, task: WorkspaceIndexTask) -> Vec<WorkspaceIndexTask> {
        self.schedule_with_result(task).superseded_tasks
    }

    pub fn schedule_with_result(
        &mut self,
        mut task: WorkspaceIndexTask,
    ) -> WorkspaceIndexScheduleResult {
        task.changed_paths.sort();
        task.changed_paths.dedup();
        if is_empty_noop_changed_paths_task(&task) {
            return WorkspaceIndexScheduleResult::default();
        }

        if task.kind == WorkspaceIndexTaskKind::ChangedPaths {
            if let Some(existing) = self.tasks.iter_mut().find(|existing| {
                existing.kind == WorkspaceIndexTaskKind::ChangedPaths
                    && existing.root_path == task.root_path
                    && existing.reason == task.reason
            }) {
                if changed_path_task_is_noop(existing, &task) {
                    return WorkspaceIndexScheduleResult::default();
                }
                self.generation += 1;
                task.generation = self.generation;
                let superseded = existing.clone();
                existing.changed_paths.extend(task.changed_paths);
                existing.changed_paths.sort();
                existing.changed_paths.dedup();
                existing.generation = task.generation;
                existing.priority = existing.priority.max(task.priority);
                existing.reason = task.reason;
                return WorkspaceIndexScheduleResult {
                    superseded_tasks: vec![superseded],
                    scheduled: true,
                };
            }
        }

        self.generation += 1;
        task.generation = self.generation;
        let cancelled = drain_replaceable_tasks(&mut self.tasks, &task);
        self.tasks.push_back(task);
        WorkspaceIndexScheduleResult {
            superseded_tasks: cancelled,
            scheduled: true,
        }
    }

    #[allow(dead_code)]
    pub fn drain_ready(&mut self) -> Vec<WorkspaceIndexTask> {
        self.drain_ready_batch(usize::MAX)
    }

    pub fn drain_ready_batch(&mut self, max_tasks: usize) -> Vec<WorkspaceIndexTask> {
        let mut tasks = self.tasks.drain(..).collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.generation.cmp(&right.generation))
        });
        let limit = if max_tasks != usize::MAX
            && tasks
                .first()
                .map(|task| is_exclusive_batch_priority(task.priority))
                .unwrap_or(false)
        {
            1
        } else {
            max_tasks
        };
        if limit >= tasks.len() {
            return tasks;
        }
        let remaining = tasks.split_off(limit);
        self.tasks = remaining.into_iter().collect();
        tasks
    }

    pub fn pending_tasks_for_root(&self, root_path: &str) -> Vec<WorkspaceIndexTask> {
        self.tasks
            .iter()
            .filter(|task| task.root_path == root_path)
            .cloned()
            .collect()
    }

    #[allow(dead_code)]
    pub fn pending_tasks(&self) -> Vec<WorkspaceIndexTask> {
        self.tasks.iter().cloned().collect()
    }

    pub fn has_pending_tasks(&self) -> bool {
        !self.tasks.is_empty()
    }
}

fn is_empty_noop_changed_paths_task(task: &WorkspaceIndexTask) -> bool {
    task.kind == WorkspaceIndexTaskKind::ChangedPaths
        && task.changed_paths.is_empty()
        && !is_workspace_discovery_task_reason(&task.reason)
}

fn changed_path_task_is_noop(existing: &WorkspaceIndexTask, task: &WorkspaceIndexTask) -> bool {
    task.priority <= existing.priority
        && task
            .changed_paths
            .iter()
            .all(|path| existing.changed_paths.binary_search(path).is_ok())
}

fn is_exclusive_batch_priority(priority: WorkspaceIndexTaskPriority) -> bool {
    priority == WorkspaceIndexTaskPriority::FullRefresh
        || priority >= WorkspaceIndexTaskPriority::ForegroundCompletion
}

#[allow(dead_code)]
pub fn task_priority_label(priority: WorkspaceIndexTaskPriority) -> &'static str {
    match priority {
        WorkspaceIndexTaskPriority::Background => "background",
        WorkspaceIndexTaskPriority::SdkIndexing => "sdkIndexing",
        WorkspaceIndexTaskPriority::FullRefresh => "fullRefresh",
        WorkspaceIndexTaskPriority::ChangedFiles => "changedFiles",
        WorkspaceIndexTaskPriority::VisibleFiles => "visibleFiles",
        WorkspaceIndexTaskPriority::Normal => "normal",
        WorkspaceIndexTaskPriority::UserBlocking => "userBlocking",
        WorkspaceIndexTaskPriority::ForegroundCompletion => "foregroundCompletion",
        WorkspaceIndexTaskPriority::ForegroundNavigation => "foregroundNavigation",
    }
}

fn drain_replaceable_tasks(
    tasks: &mut VecDeque<WorkspaceIndexTask>,
    task: &WorkspaceIndexTask,
) -> Vec<WorkspaceIndexTask> {
    drain_matching_tasks(tasks, |existing| {
        existing.root_path == task.root_path
            && task.kind != WorkspaceIndexTaskKind::ChangedPaths
            && task_kind_replaces_pending(&task.kind, &existing.kind)
    })
}

fn drain_matching_tasks<F>(
    tasks: &mut VecDeque<WorkspaceIndexTask>,
    mut should_remove: F,
) -> Vec<WorkspaceIndexTask>
where
    F: FnMut(&WorkspaceIndexTask) -> bool,
{
    let mut retained = VecDeque::new();
    let mut removed = Vec::new();
    while let Some(task) = tasks.pop_front() {
        if should_remove(&task) {
            removed.push(task);
        } else {
            retained.push_back(task);
        }
    }
    *tasks = retained;
    removed
}
