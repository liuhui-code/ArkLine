use std::collections::VecDeque;

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

impl WorkspaceIndexScheduler {
    #[allow(dead_code)]
    pub fn schedule(&mut self, mut task: WorkspaceIndexTask) -> Vec<WorkspaceIndexTask> {
        self.generation += 1;
        task.generation = self.generation;
        task.changed_paths.sort();
        task.changed_paths.dedup();

        if task.kind == WorkspaceIndexTaskKind::ChangedPaths {
            if let Some(existing) = self.tasks.iter_mut().find(|existing| {
                existing.kind == WorkspaceIndexTaskKind::ChangedPaths
                    && existing.root_path == task.root_path
                    && existing.reason == task.reason
            }) {
                let superseded = existing.clone();
                existing.changed_paths.extend(task.changed_paths);
                existing.changed_paths.sort();
                existing.changed_paths.dedup();
                existing.generation = task.generation;
                existing.priority = existing.priority.max(task.priority);
                existing.reason = task.reason;
                return vec![superseded];
            }
        }

        let cancelled = drain_replaceable_tasks(&mut self.tasks, &task);
        self.tasks.push_back(task);
        cancelled
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

#[cfg(test)]
mod tests {
    use super::{
        WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind,
        WorkspaceIndexTaskPriority,
    };

    fn changed_task(root_path: &str, paths: &[&str]) -> WorkspaceIndexTask {
        WorkspaceIndexTask {
            root_path: root_path.to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::Normal,
            changed_paths: paths.iter().map(|path| path.to_string()).collect(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "watcher".to_string(),
        }
    }

    fn sdk_task(root_path: &str, sdk_path: &str) -> WorkspaceIndexTask {
        WorkspaceIndexTask {
            root_path: root_path.to_string(),
            kind: WorkspaceIndexTaskKind::IndexSdk,
            priority: WorkspaceIndexTaskPriority::Normal,
            changed_paths: Vec::new(),
            sdk_path: Some(sdk_path.to_string()),
            sdk_version: Some("test-sdk".to_string()),
            generation: 0,
            reason: "sdk-apply".to_string(),
        }
    }

    #[test]
    fn coalesces_and_deduplicates_changed_paths_for_the_same_root() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        scheduler.schedule(changed_task("/workspace", &["B.ets", "A.ets"]));
        scheduler.schedule(changed_task("/workspace", &["B.ets", "C.ets"]));
        let tasks = scheduler.drain_ready();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].changed_paths, vec!["A.ets", "B.ets", "C.ets"]);
        assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    }

    #[test]
    fn keeps_changed_path_tasks_for_different_roots_separate() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        scheduler.schedule(changed_task("/workspace-a", &["A.ets"]));
        scheduler.schedule(changed_task("/workspace-b", &["B.ets"]));
        let tasks = scheduler.drain_ready();

        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|task| task.root_path == "/workspace-a"));
        assert!(tasks.iter().any(|task| task.root_path == "/workspace-b"));
    }

    #[test]
    fn drains_user_blocking_tasks_before_background_work() {
        let mut scheduler = WorkspaceIndexScheduler::default();
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace-a".to_string(),
            kind: WorkspaceIndexTaskKind::RefreshWorkspace,
            priority: WorkspaceIndexTaskPriority::Background,
            changed_paths: Vec::new(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "startup".to_string(),
        });
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace-b".to_string(),
            kind: WorkspaceIndexTaskKind::OpenWorkspace,
            priority: WorkspaceIndexTaskPriority::UserBlocking,
            changed_paths: Vec::new(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "open".to_string(),
        });

        let tasks = scheduler.drain_ready();

        assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::OpenWorkspace);
        assert_eq!(tasks[1].kind, WorkspaceIndexTaskKind::RefreshWorkspace);
    }

    #[test]
    fn drains_ide_priority_classes_in_foreground_first_order() {
        let mut scheduler = WorkspaceIndexScheduler::default();
        for (root_path, priority) in [
            ("/background", WorkspaceIndexTaskPriority::Background),
            ("/sdk", WorkspaceIndexTaskPriority::SdkIndexing),
            ("/full", WorkspaceIndexTaskPriority::FullRefresh),
            ("/changed", WorkspaceIndexTaskPriority::ChangedFiles),
            ("/visible", WorkspaceIndexTaskPriority::VisibleFiles),
            (
                "/completion",
                WorkspaceIndexTaskPriority::ForegroundCompletion,
            ),
            (
                "/navigation",
                WorkspaceIndexTaskPriority::ForegroundNavigation,
            ),
        ] {
            scheduler.schedule(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind: WorkspaceIndexTaskKind::RefreshWorkspace,
                priority,
                changed_paths: Vec::new(),
                sdk_path: None,
                sdk_version: None,
                generation: 0,
                reason: "test".to_string(),
            });
        }

        let roots = scheduler
            .drain_ready()
            .into_iter()
            .map(|task| task.root_path)
            .collect::<Vec<_>>();

        assert_eq!(
            roots,
            vec![
                "/navigation",
                "/completion",
                "/visible",
                "/changed",
                "/full",
                "/sdk",
                "/background",
            ]
        );
    }

    #[test]
    fn drains_bounded_batches_without_dropping_remaining_tasks() {
        let mut scheduler = WorkspaceIndexScheduler::default();
        for root_path in ["/workspace-a", "/workspace-b", "/workspace-c"] {
            scheduler.schedule(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind: WorkspaceIndexTaskKind::RefreshWorkspace,
                priority: WorkspaceIndexTaskPriority::FullRefresh,
                changed_paths: Vec::new(),
                sdk_path: None,
                sdk_version: None,
                generation: 0,
                reason: "manual".to_string(),
            });
        }

        let first_batch = scheduler.drain_ready_batch(2);
        let second_batch = scheduler.drain_ready_batch(2);

        assert_eq!(first_batch.len(), 1);
        assert_eq!(
            first_batch
                .iter()
                .map(|task| task.root_path.as_str())
                .collect::<Vec<_>>(),
            vec!["/workspace-a"]
        );
        assert_eq!(second_batch.len(), 1);
        assert_eq!(second_batch[0].root_path, "/workspace-b");
        assert!(scheduler.has_pending_tasks());
    }

    #[test]
    fn bounded_batches_run_foreground_work_without_background_tail() {
        let mut scheduler = WorkspaceIndexScheduler::default();
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::OpenWorkspace,
            priority: WorkspaceIndexTaskPriority::ForegroundNavigation,
            changed_paths: Vec::new(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "open".to_string(),
        });
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::RefreshWorkspace,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: Vec::new(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "background-refresh-after-open".to_string(),
        });

        let foreground_batch = scheduler.drain_ready_batch(8);
        let background_batch = scheduler.drain_ready_batch(8);

        assert_eq!(foreground_batch.len(), 1);
        assert_eq!(
            foreground_batch[0].kind,
            WorkspaceIndexTaskKind::OpenWorkspace
        );
        assert_eq!(background_batch.len(), 1);
        assert_eq!(
            background_batch[0].kind,
            WorkspaceIndexTaskKind::RefreshWorkspace
        );
    }

    #[test]
    fn bounded_batches_run_full_refresh_without_background_tail() {
        let mut scheduler = WorkspaceIndexScheduler::default();
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: vec!["A.ets".to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "full-refresh-files:refresh-workspace".to_string(),
        });
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::Background,
            changed_paths: vec!["A.ets".to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "full-refresh-deep:refresh-workspace".to_string(),
        });

        let full_refresh_batch = scheduler.drain_ready_batch(8);
        let background_batch = scheduler.drain_ready_batch(8);

        assert_eq!(full_refresh_batch.len(), 1);
        assert_eq!(background_batch.len(), 1);
        assert_eq!(
            full_refresh_batch[0].reason,
            "full-refresh-files:refresh-workspace"
        );
        assert_eq!(
            background_batch[0].reason,
            "full-refresh-deep:refresh-workspace"
        );
    }

    #[test]
    fn keeps_changed_path_tasks_with_different_reasons_separate() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: vec!["A.ets".to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "full-refresh-files:refresh-workspace".to_string(),
        });
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::Background,
            changed_paths: vec!["A.ets".to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "full-refresh-deep:refresh-workspace".to_string(),
        });

        let tasks = scheduler.drain_ready();

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].reason, "full-refresh-files:refresh-workspace");
        assert_eq!(tasks[1].reason, "full-refresh-deep:refresh-workspace");
    }

    #[test]
    fn wider_refresh_replaces_pending_changed_paths_for_the_same_root() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        let first_cancelled = scheduler.schedule(changed_task("/workspace", &["A.ets"]));
        let second_cancelled = scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::RefreshWorkspace,
            priority: WorkspaceIndexTaskPriority::Normal,
            changed_paths: Vec::new(),
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "manual".to_string(),
        });
        let tasks = scheduler.drain_ready();

        assert!(first_cancelled.is_empty());
        assert_eq!(second_cancelled.len(), 1);
        assert_eq!(
            second_cancelled[0].kind,
            WorkspaceIndexTaskKind::ChangedPaths
        );
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::RefreshWorkspace);
        assert!(tasks[0].generation > 0);
        assert!(tasks[0].generation > second_cancelled[0].generation);
    }

    #[test]
    fn replaces_queued_sdk_task_for_the_same_root() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        let first_cancelled = scheduler.schedule(sdk_task("/workspace", "/sdk/old"));
        let second_cancelled = scheduler.schedule(sdk_task("/workspace", "/sdk/new"));
        let tasks = scheduler.drain_ready();

        assert!(first_cancelled.is_empty());
        assert_eq!(second_cancelled.len(), 1);
        assert_eq!(second_cancelled[0].sdk_path.as_deref(), Some("/sdk/old"));
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].sdk_path.as_deref(), Some("/sdk/new"));
        assert!(tasks[0].generation > second_cancelled[0].generation);
    }
}
