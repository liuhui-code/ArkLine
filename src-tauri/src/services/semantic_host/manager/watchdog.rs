use std::sync::{Arc, Weak};
use std::thread;
use std::time::Duration;

use super::SemanticHostManager;
use crate::services::semantic_host::session::IdleHealthProbe;

const IDLE_PROBE_INTERVAL: Duration = Duration::from_secs(30);

impl SemanticHostManager {
    pub fn start_idle_watchdog(self: &Arc<Self>) {
        spawn_watchdog(Arc::downgrade(self), IDLE_PROBE_INTERVAL);
    }

    fn probe_idle(&self, minimum_idle: Duration) {
        if !self.supervisor.should_probe_idle(minimum_idle) {
            return;
        }
        let session = self
            .session
            .lock()
            .ok()
            .and_then(|current| current.as_ref().cloned());
        let Some(session) = session else { return };
        match session.try_health() {
            IdleHealthProbe::Busy => {}
            IdleHealthProbe::Healthy => {
                if self.supervisor.mark_success(session.runtime_snapshot()) {
                    self.invalidate(&session);
                }
            }
            IdleHealthProbe::Failed(error) => {
                self.supervisor.mark_terminal_failure(&error);
                self.invalidate(&session);
            }
        }
    }
}

fn spawn_watchdog(manager: Weak<SemanticHostManager>, interval: Duration) {
    thread::spawn(move || loop {
        thread::sleep(interval);
        let Some(manager) = manager.upgrade() else {
            break;
        };
        manager.probe_idle(interval);
    });
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use super::spawn_watchdog;
    use crate::services::semantic_host::config::SemanticHostConfig;
    use crate::services::semantic_host::manager::SemanticHostManager;

    #[test]
    fn watchdog_does_not_keep_manager_alive() {
        let manager = Arc::new(SemanticHostManager::discover(SemanticHostConfig::default()));
        let weak = Arc::downgrade(&manager);
        spawn_watchdog(weak.clone(), Duration::from_millis(1));
        drop(manager);
        thread::sleep(Duration::from_millis(10));

        assert!(weak.upgrade().is_none());
    }
}
