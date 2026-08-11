use std::collections::{BTreeMap, VecDeque};
use std::time::{Duration, Instant};

use crate::services::workspace_discovery_task_service::is_workspace_discovery_task_reason;
use crate::services::workspace_index_task_admission_service::{latest_wins, tasks_can_coalesce};
use crate::services::workspace_index_task_lifecycle_service::task_kind_replaces_pending;

const FOREGROUND_BURST_LIMIT: usize = 3;

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
    delayed_tasks: Vec<DelayedWorkspaceIndexTask>,
    delayed_attempts: BTreeMap<(String, String), usize>,
    foreground_burst: usize,
}

#[derive(Debug, Clone)]
struct DelayedWorkspaceIndexTask {
    ready_at: Instant,
    task: WorkspaceIndexTask,
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
            if let Some(existing) = self
                .tasks
                .iter_mut()
                .find(|existing| tasks_can_coalesce(existing, &task))
            {
                if changed_path_task_is_noop(existing, &task) {
                    return WorkspaceIndexScheduleResult::default();
                }
                self.generation += 1;
                task.generation = self.generation;
                let superseded = existing.clone();
                if latest_wins(&task) {
                    *existing = task;
                    return WorkspaceIndexScheduleResult {
                        superseded_tasks: vec![superseded],
                        scheduled: true,
                    };
                }
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

        if preserves_continuation_generation(&task) {
            self.generation = self.generation.max(task.generation);
        } else {
            self.generation += 1;
            task.generation = self.generation;
        }
        let cancelled = drain_replaceable_tasks(&mut self.tasks, &task);
        self.tasks.push_back(task);
        WorkspaceIndexScheduleResult {
            superseded_tasks: cancelled,
            scheduled: true,
        }
    }

    pub fn schedule_background_retry(
        &mut self,
        mut task: WorkspaceIndexTask,
    ) -> WorkspaceIndexScheduleResult {
        task.changed_paths.sort();
        task.changed_paths.dedup();
        let key = (task.root_path.clone(), task.reason.clone());
        let attempt = self.delayed_attempts.entry(key).or_default();
        *attempt = attempt.saturating_add(1);
        let delay = background_retry_delay(*attempt);

        if let Some(existing) = self
            .delayed_tasks
            .iter_mut()
            .find(|existing| tasks_can_coalesce(&existing.task, &task))
        {
            if changed_path_task_is_noop(&existing.task, &task) {
                return WorkspaceIndexScheduleResult::default();
            }
            self.generation += 1;
            task.generation = self.generation;
            let superseded = existing.task.clone();
            if latest_wins(&task) {
                existing.task = task;
                existing.ready_at = Instant::now() + delay;
                return WorkspaceIndexScheduleResult {
                    superseded_tasks: vec![superseded],
                    scheduled: true,
                };
            }
            existing.task.changed_paths.extend(task.changed_paths);
            existing.task.changed_paths.sort();
            existing.task.changed_paths.dedup();
            existing.task.generation = task.generation;
            existing.task.priority = existing.task.priority.max(task.priority);
            existing.ready_at = Instant::now() + delay;
            return WorkspaceIndexScheduleResult {
                superseded_tasks: vec![superseded],
                scheduled: true,
            };
        }

        if preserves_continuation_generation(&task) {
            self.generation = self.generation.max(task.generation);
        } else {
            self.generation += 1;
            task.generation = self.generation;
        }
        self.delayed_tasks.push(DelayedWorkspaceIndexTask {
            ready_at: Instant::now() + delay,
            task,
        });
        WorkspaceIndexScheduleResult {
            superseded_tasks: Vec::new(),
            scheduled: true,
        }
    }

    pub fn clear_background_retry(&mut self, root_path: &str, reason: &str) {
        self.delayed_attempts
            .remove(&(root_path.to_string(), reason.to_string()));
    }

    #[allow(dead_code)]
    pub fn drain_ready(&mut self) -> Vec<WorkspaceIndexTask> {
        self.drain_ready_batch(usize::MAX)
    }

    pub fn drain_ready_batch(&mut self, max_tasks: usize) -> Vec<WorkspaceIndexTask> {
        self.promote_ready_delayed_tasks();
        let mut tasks = self.tasks.drain(..).collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.generation.cmp(&right.generation))
        });
        promote_background_turn(&mut tasks, self.foreground_burst);
        let limit = if max_tasks != usize::MAX
            && tasks
                .first()
                .map(|task| is_single_unit_batch_priority(task.priority))
                .unwrap_or(false)
        {
            1
        } else {
            max_tasks
        };
        if limit >= tasks.len() {
            self.record_dispatch(&tasks);
            return tasks;
        }
        let remaining = tasks.split_off(limit);
        self.tasks = remaining.into_iter().collect();
        self.record_dispatch(&tasks);
        tasks
    }

    pub fn pending_tasks_for_root(&self, root_path: &str) -> Vec<WorkspaceIndexTask> {
        self.tasks
            .iter()
            .filter(|task| task.root_path == root_path)
            .cloned()
            .chain(
                self.delayed_tasks
                    .iter()
                    .filter(|pending| pending.task.root_path == root_path)
                    .map(|pending| pending.task.clone()),
            )
            .collect()
    }

    pub fn drain_tasks_for_root(&mut self, root_path: &str) -> Vec<WorkspaceIndexTask> {
        let mut removed = drain_matching_tasks(&mut self.tasks, |task| task.root_path == root_path);
        let mut retained = Vec::new();
        for delayed in self.delayed_tasks.drain(..) {
            if delayed.task.root_path == root_path {
                removed.push(delayed.task);
            } else {
                retained.push(delayed);
            }
        }
        self.delayed_tasks = retained;
        self.delayed_attempts
            .retain(|(task_root, _), _| task_root != root_path);
        removed
    }

    #[allow(dead_code)]
    pub fn pending_tasks(&self) -> Vec<WorkspaceIndexTask> {
        self.tasks
            .iter()
            .cloned()
            .chain(
                self.delayed_tasks
                    .iter()
                    .map(|pending| pending.task.clone()),
            )
            .collect()
    }

    pub fn has_pending_tasks(&self) -> bool {
        !self.tasks.is_empty() || !self.delayed_tasks.is_empty()
    }

    pub fn next_ready_delay(&self) -> Option<Duration> {
        if !self.tasks.is_empty() {
            return Some(Duration::ZERO);
        }
        let now = Instant::now();
        self.delayed_tasks
            .iter()
            .map(|pending| pending.ready_at.saturating_duration_since(now))
            .min()
    }

    fn promote_ready_delayed_tasks(&mut self) {
        let now = Instant::now();
        let mut pending = Vec::new();
        self.delayed_tasks.retain(|delayed| {
            if delayed.ready_at > now {
                return true;
            }
            pending.push(delayed.task.clone());
            false
        });
        self.tasks.extend(pending);
    }

    fn record_dispatch(&mut self, tasks: &[WorkspaceIndexTask]) {
        let Some(first) = tasks.first() else {
            return;
        };
        if is_foreground_burst_task(first.priority) {
            self.foreground_burst = self.foreground_burst.saturating_add(1);
        } else if is_background_fairness_task(first.priority) {
            self.foreground_burst = 0;
        }
    }
}

fn promote_background_turn(tasks: &mut [WorkspaceIndexTask], foreground_burst: usize) {
    if foreground_burst < FOREGROUND_BURST_LIMIT
        || !tasks
            .first()
            .is_some_and(|task| is_foreground_burst_task(task.priority))
    {
        return;
    }
    let Some(index) = tasks
        .iter()
        .position(|task| is_background_fairness_task(task.priority))
    else {
        return;
    };
    tasks.swap(0, index);
}

fn is_foreground_burst_task(priority: WorkspaceIndexTaskPriority) -> bool {
    priority >= WorkspaceIndexTaskPriority::ForegroundCompletion
}

fn is_background_fairness_task(priority: WorkspaceIndexTaskPriority) -> bool {
    priority <= WorkspaceIndexTaskPriority::FullRefresh
}

fn background_retry_delay(attempt: usize) -> Duration {
    const BASE_DELAY: Duration = Duration::from_millis(250);
    const MAX_DELAY: Duration = Duration::from_secs(5);
    let multiplier = 1u32 << attempt.saturating_sub(1).min(4);
    BASE_DELAY.saturating_mul(multiplier).min(MAX_DELAY)
}

fn preserves_continuation_generation(task: &WorkspaceIndexTask) -> bool {
    if task.kind != WorkspaceIndexTaskKind::ChangedPaths || task.generation == 0 {
        return false;
    }
    (is_workspace_discovery_task_reason(&task.reason) && !task.changed_paths.is_empty())
        || task.reason.starts_with("full-refresh-deep:")
}

fn is_empty_noop_changed_paths_task(task: &WorkspaceIndexTask) -> bool {
    task.kind == WorkspaceIndexTaskKind::ChangedPaths
        && task.changed_paths.is_empty()
        && !is_workspace_discovery_task_reason(&task.reason)
        && !task.reason.starts_with("full-refresh-deep:")
}

fn changed_path_task_is_noop(existing: &WorkspaceIndexTask, task: &WorkspaceIndexTask) -> bool {
    task.priority <= existing.priority
        && task
            .changed_paths
            .iter()
            .all(|path| existing.changed_paths.binary_search(path).is_ok())
}

fn is_single_unit_batch_priority(priority: WorkspaceIndexTaskPriority) -> bool {
    priority == WorkspaceIndexTaskPriority::FullRefresh
        || priority == WorkspaceIndexTaskPriority::Background
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
