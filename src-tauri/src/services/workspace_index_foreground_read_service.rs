use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;

const FOREGROUND_READ_POLL_INTERVAL: Duration = Duration::from_millis(5);
const FOREGROUND_READ_MAX_YIELD: Duration = Duration::from_millis(250);

#[derive(Clone, Default)]
pub(crate) struct WorkspaceIndexForegroundReadGate {
    active_reads: Arc<AtomicUsize>,
}

pub(crate) struct WorkspaceIndexForegroundReadGuard {
    active_reads: Arc<AtomicUsize>,
}

impl WorkspaceIndexForegroundReadGate {
    pub(crate) fn begin(&self) -> WorkspaceIndexForegroundReadGuard {
        self.active_reads.fetch_add(1, Ordering::SeqCst);
        WorkspaceIndexForegroundReadGuard {
            active_reads: Arc::clone(&self.active_reads),
        }
    }

    pub(crate) fn yield_background(&self, priority: PublicationPriority, cancelled: &AtomicBool) {
        if !matches!(
            priority,
            PublicationPriority::Background | PublicationPriority::IdleMaintenance
        ) {
            return;
        }
        let deadline = Instant::now() + FOREGROUND_READ_MAX_YIELD;
        while self.active_reads.load(Ordering::SeqCst) > 0 && Instant::now() < deadline {
            if cancelled.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(FOREGROUND_READ_POLL_INTERVAL);
        }
    }
}

impl Drop for WorkspaceIndexForegroundReadGuard {
    fn drop(&mut self) {
        self.active_reads.fetch_sub(1, Ordering::SeqCst);
    }
}
