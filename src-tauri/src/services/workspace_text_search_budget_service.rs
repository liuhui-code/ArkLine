use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub(crate) struct WorkspaceTextSearchBudget {
    max_bytes: Option<u64>,
    max_duration: Option<Duration>,
}

impl WorkspaceTextSearchBudget {
    pub(crate) fn interactive() -> Self {
        Self {
            max_bytes: Some(8 * 1024 * 1024),
            max_duration: Some(Duration::from_millis(150)),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_max_bytes(max_bytes: u64) -> Self {
        Self {
            max_bytes: Some(max_bytes),
            max_duration: None,
        }
    }
}

pub(crate) fn budget_exhausted(
    budget: WorkspaceTextSearchBudget,
    started_at: Instant,
    inspected_bytes: u64,
    next_file_bytes: u64,
) -> bool {
    budget
        .max_duration
        .is_some_and(|duration| started_at.elapsed() >= duration)
        || budget
            .max_bytes
            .is_some_and(|max_bytes| inspected_bytes.saturating_add(next_file_bytes) > max_bytes)
}
