use std::sync::{Arc, Condvar, Mutex};

use crate::indexer_host::IndexerHostRuntime;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTaskPriority,
};

pub(crate) fn wait_for_sidecar_retry_if_only_background_is_pending(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    indexer: &IndexerHostRuntime,
    worker_signal: &Arc<(Mutex<u64>, Condvar)>,
) {
    let (only_background, scheduler_delay) = scheduler
        .lock()
        .map(|scheduler| {
            let tasks = scheduler.pending_tasks();
            (
                !tasks.is_empty()
                    && tasks
                        .iter()
                        .all(|task| task.priority == WorkspaceIndexTaskPriority::Background),
                scheduler.next_ready_delay(),
            )
        })
        .unwrap_or((false, None));
    if !only_background {
        return;
    }
    let delay = match (indexer.backoff_remaining(), scheduler_delay) {
        (Some(indexer_delay), Some(scheduler_delay)) => indexer_delay.min(scheduler_delay),
        (Some(delay), None) | (None, Some(delay)) => delay,
        (None, None) => return,
    };
    if delay.is_zero() {
        return;
    }

    let (signal_lock, signal) = &**worker_signal;
    let Ok(generation) = signal_lock.lock() else {
        return;
    };
    let observed_generation = *generation;
    let _ = signal.wait_timeout_while(generation, delay, |current_generation| {
        *current_generation == observed_generation
    });
}
