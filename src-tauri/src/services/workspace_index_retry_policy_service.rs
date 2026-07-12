use crate::models::workspace::WorkspaceIndexTaskStatus;

const BACKOFF_DELAYS_MS: [u64; 4] = [2_000, 5_000, 15_000, 30_000];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexRetryBackoff {
    pub failure_count: usize,
    pub retry_after_ms: u64,
    pub exhausted: bool,
    pub reason: String,
}

pub fn retry_backoff_for_failed_statuses(
    current: &WorkspaceIndexTaskStatus,
    recent_statuses: &[WorkspaceIndexTaskStatus],
) -> Option<WorkspaceIndexRetryBackoff> {
    if current.status != "failed" {
        return None;
    }
    let failure_count = consecutive_failure_count(current, recent_statuses);
    if failure_count < 2 {
        return None;
    }
    let delay_index = failure_count
        .saturating_sub(2)
        .min(BACKOFF_DELAYS_MS.len() - 1);
    Some(WorkspaceIndexRetryBackoff {
        failure_count,
        retry_after_ms: BACKOFF_DELAYS_MS[delay_index],
        exhausted: failure_count > BACKOFF_DELAYS_MS.len() + 1,
        reason: format!(
            "{} failed {failure_count} consecutive time(s)",
            current.kind
        ),
    })
}

fn consecutive_failure_count(
    current: &WorkspaceIndexTaskStatus,
    recent_statuses: &[WorkspaceIndexTaskStatus],
) -> usize {
    recent_statuses
        .iter()
        .rev()
        .filter(|status| {
            status.root_path == current.root_path
                && status.kind == current.kind
                && status.reason == current.reason
        })
        .take_while(|status| status.status == "failed")
        .count()
}
