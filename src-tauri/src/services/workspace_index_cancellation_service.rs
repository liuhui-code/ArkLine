use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind,
};
use crate::services::workspace_index_task_lifecycle_service::task_kind_replaces_pending;

#[derive(Debug, Clone)]
pub struct WorkspaceIndexCancellationToken {
    generation: u64,
    cancelled: Arc<AtomicBool>,
}

impl WorkspaceIndexCancellationToken {
    pub fn new(generation: u64) -> Self {
        Self {
            generation,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Default)]
pub struct WorkspaceIndexCancellationRegistry {
    active_tasks: Vec<WorkspaceIndexActiveCancellation>,
}

impl WorkspaceIndexCancellationRegistry {
    pub fn start_task(&mut self, task: &WorkspaceIndexTask) -> WorkspaceIndexCancellationToken {
        let token = WorkspaceIndexCancellationToken::new(task.generation);
        self.active_tasks.push(WorkspaceIndexActiveCancellation {
            root_path: task.root_path.clone(),
            kind: task.kind.clone(),
            generation: task.generation,
            token: token.clone(),
        });
        token
    }

    pub fn finish_task(&mut self, token: &WorkspaceIndexCancellationToken) {
        self.active_tasks
            .retain(|task| task.generation != token.generation());
    }

    pub fn cancel_superseded_by(
        &mut self,
        task: &WorkspaceIndexTask,
    ) -> Vec<WorkspaceIndexCancellationToken> {
        let mut cancelled = Vec::new();
        for active in &self.active_tasks {
            if active.root_path == task.root_path
                && task.generation > active.generation
                && task_kind_replaces_pending(&task.kind, &active.kind)
            {
                active.token.cancel();
                cancelled.push(active.token.clone());
            }
        }
        cancelled
    }

    pub fn cancel_root(&mut self, root_path: &str) -> Vec<WorkspaceIndexCancellationToken> {
        let mut cancelled = Vec::new();
        for active in &self.active_tasks {
            if active.root_path == root_path {
                active.token.cancel();
                cancelled.push(active.token.clone());
            }
        }
        cancelled
    }
}

#[derive(Debug)]
struct WorkspaceIndexActiveCancellation {
    root_path: String,
    kind: WorkspaceIndexTaskKind,
    generation: u64,
    token: WorkspaceIndexCancellationToken,
}

pub type CancellableIndexTask = (WorkspaceIndexTask, WorkspaceIndexCancellationToken);

pub fn start_cancellable_tasks(
    cancellations: &Mutex<WorkspaceIndexCancellationRegistry>,
    tasks: Vec<WorkspaceIndexTask>,
) -> Result<
    (
        Vec<CancellableIndexTask>,
        Vec<WorkspaceIndexCancellationToken>,
    ),
    String,
> {
    let mut cancellations = cancellations
        .lock()
        .map_err(|_| "Workspace index cancellation lock poisoned".to_string())?;
    let mut guarded_tasks = Vec::new();
    let mut tokens = Vec::new();
    for task in tasks {
        let token = cancellations.start_task(&task);
        tokens.push(token.clone());
        guarded_tasks.push((task, token));
    }
    Ok((guarded_tasks, tokens))
}

pub fn finish_cancellable_tasks(
    cancellations: &Mutex<WorkspaceIndexCancellationRegistry>,
    tokens: &[WorkspaceIndexCancellationToken],
) -> Result<(), String> {
    let mut cancellations = cancellations
        .lock()
        .map_err(|_| "Workspace index cancellation lock poisoned".to_string())?;
    for token in tokens {
        cancellations.finish_task(token);
    }
    Ok(())
}

pub fn cancel_active_tasks_superseded_by_latest(
    cancellations: &Mutex<WorkspaceIndexCancellationRegistry>,
    scheduler: &Mutex<WorkspaceIndexScheduler>,
    root_path: &str,
    kind: WorkspaceIndexTaskKind,
) -> Result<(), String> {
    let latest = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
        .pending_tasks_for_root(root_path)
        .into_iter()
        .filter(|task| task.kind == kind)
        .max_by(|left, right| left.generation.cmp(&right.generation));
    if let Some(task) = latest {
        cancellations
            .lock()
            .map_err(|_| "Workspace index cancellation lock poisoned".to_string())?
            .cancel_superseded_by(&task);
    }
    Ok(())
}
