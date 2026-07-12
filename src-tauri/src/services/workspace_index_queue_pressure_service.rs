use crate::models::workspace::WorkspaceIndexQueuePressure;
use crate::services::workspace_index_scheduler_service::{task_priority_label, WorkspaceIndexTask};
use crate::services::workspace_index_task_status_service::task_kind_label;

pub(crate) fn project_queue_pressure(
    root_path: &str,
    tasks: &[WorkspaceIndexTask],
) -> WorkspaceIndexQueuePressure {
    let highest = tasks.iter().max_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| right.generation.cmp(&left.generation))
    });

    WorkspaceIndexQueuePressure {
        root_path: root_path.to_string(),
        pending_task_count: tasks.len(),
        workspace_pending_task_count: tasks
            .iter()
            .filter(|task| task.root_path == root_path)
            .count(),
        highest_priority: highest.map(|task| task_priority_label(task.priority).to_string()),
        highest_priority_task_kind: highest.map(|task| task_kind_label(&task.kind).to_string()),
    }
}
