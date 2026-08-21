use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) fn relinquish_background_worker(
    worker_running: &AtomicBool,
    has_pending_tasks: impl FnOnce() -> bool,
) -> bool {
    worker_running.store(false, Ordering::SeqCst);
    if !has_pending_tasks() {
        return false;
    }

    !worker_running.swap(true, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retiring_worker_reclaims_ownership_when_work_arrives_before_release() {
        let worker_running = AtomicBool::new(true);

        assert!(relinquish_background_worker(&worker_running, || true));
        assert!(worker_running.load(Ordering::SeqCst));
    }

    #[test]
    fn retiring_worker_exits_when_a_new_worker_claims_pending_work() {
        let worker_running = AtomicBool::new(true);

        let reclaimed = relinquish_background_worker(&worker_running, || {
            assert!(!worker_running.swap(true, Ordering::SeqCst));
            true
        });

        assert!(!reclaimed);
        assert!(worker_running.load(Ordering::SeqCst));
    }
}
