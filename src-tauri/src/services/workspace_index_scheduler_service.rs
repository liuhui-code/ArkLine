use std::collections::VecDeque;

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
    Normal,
    UserBlocking,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexTask {
    pub root_path: String,
    pub kind: WorkspaceIndexTaskKind,
    pub priority: WorkspaceIndexTaskPriority,
    pub changed_paths: Vec<String>,
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
    pub fn schedule(&mut self, mut task: WorkspaceIndexTask) {
        self.generation += 1;
        task.generation = self.generation;
        task.changed_paths.sort();
        task.changed_paths.dedup();

        if task.kind == WorkspaceIndexTaskKind::ChangedPaths {
            if let Some(existing) = self.tasks.iter_mut().find(|existing| {
                existing.kind == WorkspaceIndexTaskKind::ChangedPaths
                    && existing.root_path == task.root_path
            }) {
                existing.changed_paths.extend(task.changed_paths);
                existing.changed_paths.sort();
                existing.changed_paths.dedup();
                existing.generation = task.generation;
                existing.priority = existing.priority.max(task.priority);
                existing.reason = task.reason;
                return;
            }
        }

        self.tasks.push_back(task);
    }

    #[allow(dead_code)]
    pub fn drain_ready(&mut self) -> Vec<WorkspaceIndexTask> {
        let mut tasks = self.tasks.drain(..).collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.generation.cmp(&right.generation))
        });
        tasks
    }
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
            generation: 0,
            reason: "watcher".to_string(),
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
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::RefreshWorkspace,
            priority: WorkspaceIndexTaskPriority::Background,
            changed_paths: Vec::new(),
            generation: 0,
            reason: "startup".to_string(),
        });
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::OpenWorkspace,
            priority: WorkspaceIndexTaskPriority::UserBlocking,
            changed_paths: Vec::new(),
            generation: 0,
            reason: "open".to_string(),
        });

        let tasks = scheduler.drain_ready();

        assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::OpenWorkspace);
        assert_eq!(tasks[1].kind, WorkspaceIndexTaskKind::RefreshWorkspace);
    }

    #[test]
    fn assigns_monotonic_generations_when_scheduling() {
        let mut scheduler = WorkspaceIndexScheduler::default();

        scheduler.schedule(changed_task("/workspace", &["A.ets"]));
        scheduler.schedule(WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::RefreshWorkspace,
            priority: WorkspaceIndexTaskPriority::Normal,
            changed_paths: Vec::new(),
            generation: 0,
            reason: "manual".to_string(),
        });
        let tasks = scheduler.drain_ready();

        assert!(tasks[0].generation > 0);
        assert!(tasks[1].generation > tasks[0].generation);
    }
}
