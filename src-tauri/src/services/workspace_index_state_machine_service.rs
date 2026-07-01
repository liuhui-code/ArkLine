#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexTaskState {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Ready,
    Partial,
    Failed,
    Superseded,
}

pub fn transition_task_state(
    current: WorkspaceIndexTaskState,
    next: WorkspaceIndexTaskState,
) -> Result<WorkspaceIndexTaskState, String> {
    if is_allowed_transition(current, next) {
        Ok(next)
    } else {
        Err(format!(
            "Invalid workspace index task transition: {} -> {}",
            task_state_label(current),
            task_state_label(next)
        ))
    }
}

pub fn should_publish_task_result(result_generation: u64, latest_generation: u64) -> bool {
    result_generation >= latest_generation
}

fn is_allowed_transition(current: WorkspaceIndexTaskState, next: WorkspaceIndexTaskState) -> bool {
    use WorkspaceIndexTaskState::{
        Cancelled, Cancelling, Failed, Partial, Queued, Ready, Running, Superseded,
    };

    match current {
        Queued => matches!(next, Running | Cancelled | Superseded),
        Running => matches!(next, Cancelling | Ready | Partial | Failed | Superseded),
        Cancelling => matches!(next, Cancelled | Failed),
        Cancelled | Ready | Partial | Failed | Superseded => false,
    }
}

pub fn task_state_label(state: WorkspaceIndexTaskState) -> &'static str {
    match state {
        WorkspaceIndexTaskState::Queued => "queued",
        WorkspaceIndexTaskState::Running => "running",
        WorkspaceIndexTaskState::Cancelling => "cancelling",
        WorkspaceIndexTaskState::Cancelled => "cancelled",
        WorkspaceIndexTaskState::Ready => "ready",
        WorkspaceIndexTaskState::Partial => "partial",
        WorkspaceIndexTaskState::Failed => "failed",
        WorkspaceIndexTaskState::Superseded => "superseded",
    }
}
