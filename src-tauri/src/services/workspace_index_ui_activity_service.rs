use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexUiActivityKind {
    Completion,
    FileOpen,
    Navigation,
    SearchInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WorkspaceIndexUiActivity {
    kind: WorkspaceIndexUiActivityKind,
    expires_at_ms: u64,
}

#[derive(Clone, Default)]
pub struct WorkspaceIndexUiActivityRuntime {
    activity: Arc<Mutex<Option<WorkspaceIndexUiActivity>>>,
}

impl WorkspaceIndexUiActivityRuntime {
    pub fn record_ui_activity(
        &self,
        kind: WorkspaceIndexUiActivityKind,
        now_ms: u64,
    ) -> Result<(), String> {
        let mut activity = self
            .activity
            .lock()
            .map_err(|_| "Workspace UI activity lock poisoned".to_string())?;
        *activity = Some(WorkspaceIndexUiActivity {
            kind,
            expires_at_ms: now_ms + activity_window_ms(kind),
        });
        Ok(())
    }

    pub fn current_ui_activity(
        &self,
        now_ms: u64,
    ) -> Result<Option<WorkspaceIndexUiActivityKind>, String> {
        let activity = self
            .activity
            .lock()
            .map_err(|_| "Workspace UI activity lock poisoned".to_string())?;
        Ok(activity
            .filter(|current| current.expires_at_ms >= now_ms)
            .map(|current| current.kind))
    }

    pub fn is_latency_sensitive(&self, now_ms: u64) -> Result<bool, String> {
        Ok(self.current_ui_activity(now_ms)?.is_some())
    }
}

fn activity_window_ms(kind: WorkspaceIndexUiActivityKind) -> u64 {
    match kind {
        WorkspaceIndexUiActivityKind::FileOpen => 1_500,
        WorkspaceIndexUiActivityKind::Completion
        | WorkspaceIndexUiActivityKind::Navigation
        | WorkspaceIndexUiActivityKind::SearchInput => 750,
    }
}
