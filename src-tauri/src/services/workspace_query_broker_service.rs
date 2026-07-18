use std::time::{Duration, Instant};

use crate::services::workspace_search_session_service::WorkspaceSearchSessionRuntime;

pub const ENTITY_QUERY_DEADLINE_MS: u64 = 250;
pub const CONTENT_QUERY_DEADLINE_MS: u64 = 1_500;
const MAX_QUERY_DEADLINE_MS: u64 = 30_000;

#[derive(Clone)]
pub struct WorkspaceQueryBrokerRuntime {
    sessions: WorkspaceSearchSessionRuntime,
}

impl WorkspaceQueryBrokerRuntime {
    pub fn new(sessions: WorkspaceSearchSessionRuntime) -> Self {
        Self { sessions }
    }

    pub fn begin(
        &self,
        root_path: &str,
        kind: &str,
        generation: Option<u64>,
        deadline_ms: u64,
    ) -> Result<WorkspaceQueryTicket, String> {
        if let Some(generation) = generation {
            self.sessions
                .register_generation(root_path, kind, generation)?;
        }
        Ok(WorkspaceQueryTicket {
            sessions: self.sessions.clone(),
            root_path: root_path.to_string(),
            kind: kind.to_string(),
            generation,
            deadline: Instant::now()
                + Duration::from_millis(deadline_ms.clamp(1, MAX_QUERY_DEADLINE_MS)),
        })
    }

    pub fn cancel(&self, root_path: &str, kind: &str, generation: u64) -> Result<(), String> {
        self.sessions.cancel_generation(root_path, kind, generation)
    }
}

#[derive(Clone)]
pub struct WorkspaceQueryTicket {
    sessions: WorkspaceSearchSessionRuntime,
    root_path: String,
    kind: String,
    generation: Option<u64>,
    deadline: Instant,
}

impl WorkspaceQueryTicket {
    pub fn check(&self) -> Result<(), String> {
        self.ensure_current()?;
        if self.deadline_exceeded() {
            return Err("Workspace query deadline exceeded".to_string());
        }
        Ok(())
    }

    pub fn ensure_current(&self) -> Result<(), String> {
        if self.is_superseded() {
            return Err("Workspace query superseded".to_string());
        }
        Ok(())
    }

    pub fn should_cancel(&self) -> bool {
        self.is_superseded() || self.deadline_exceeded()
    }

    pub fn deadline_exceeded(&self) -> bool {
        Instant::now() >= self.deadline
    }

    fn is_superseded(&self) -> bool {
        self.generation
            .and_then(|generation| {
                self.sessions
                    .is_generation_stale(&self.root_path, &self.kind, generation)
                    .ok()
            })
            .unwrap_or(false)
    }
}
