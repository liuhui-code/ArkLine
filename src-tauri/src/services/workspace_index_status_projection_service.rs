use std::collections::HashMap;

use crate::models::workspace::WorkspaceIndexTaskStatus;

const WORKSPACE_INDEX_TASK_STALL_TIMEOUT_MS: u128 = 60_000;

pub(crate) fn project_task_statuses(
    statuses: Vec<WorkspaceIndexTaskStatus>,
    now: u128,
) -> Vec<WorkspaceIndexTaskStatus> {
    let mut statuses = merge_task_statuses(statuses);
    mark_stalled_task_statuses(&mut statuses, now);
    statuses
}

pub(crate) fn mark_stalled_task_statuses(statuses: &mut [WorkspaceIndexTaskStatus], now: u128) {
    for status in statuses {
        if status.status != "running" {
            continue;
        }
        let Some(last_heartbeat_at) = status.last_heartbeat_at.or(status.started_at) else {
            continue;
        };
        if now.saturating_sub(last_heartbeat_at) <= WORKSPACE_INDEX_TASK_STALL_TIMEOUT_MS {
            continue;
        }
        status.stalled = true;
        if status.message.is_none() {
            status.message = Some("No heartbeat for 60s".to_string());
        }
    }
}

pub(crate) fn is_terminal_task_status(status: &str) -> bool {
    matches!(
        status,
        "ready" | "partial" | "failed" | "cancelled" | "superseded" | "skipped"
    )
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
