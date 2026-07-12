use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct WorkspaceSearchSessionKey {
    root_path: String,
    kind: String,
}

#[derive(Clone, Default)]
pub struct WorkspaceSearchSessionRuntime {
    latest_generations: Arc<Mutex<HashMap<WorkspaceSearchSessionKey, u64>>>,
}

impl WorkspaceSearchSessionRuntime {
    pub fn register_generation(
        &self,
        root_path: &str,
        kind: &str,
        generation: u64,
    ) -> Result<(), String> {
        let mut generations = self
            .latest_generations
            .lock()
            .map_err(|_| "Workspace search session lock poisoned".to_string())?;
        let latest = generations
            .entry(session_key(root_path, kind))
            .or_insert(generation);
        *latest = (*latest).max(generation);
        Ok(())
    }

    pub fn cancel_generation(
        &self,
        root_path: &str,
        kind: &str,
        generation: u64,
    ) -> Result<(), String> {
        self.register_generation(root_path, kind, generation.saturating_add(1))
    }

    pub fn is_generation_stale(
        &self,
        root_path: &str,
        kind: &str,
        generation: u64,
    ) -> Result<bool, String> {
        let generations = self
            .latest_generations
            .lock()
            .map_err(|_| "Workspace search session lock poisoned".to_string())?;
        Ok(generations
            .get(&session_key(root_path, kind))
            .is_some_and(|latest| *latest > generation))
    }
}

fn session_key(root_path: &str, kind: &str) -> WorkspaceSearchSessionKey {
    WorkspaceSearchSessionKey {
        root_path: root_path.to_string(),
        kind: kind.to_string(),
    }
}
