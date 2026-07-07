use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkspaceTextSearchGeneration {
    pub requested_generation: u64,
    pub latest_generation: u64,
}

impl WorkspaceTextSearchGeneration {
    pub fn is_stale(&self) -> bool {
        is_text_search_generation_stale(self.requested_generation, self.latest_generation)
    }
}

pub fn is_text_search_generation_stale(requested_generation: u64, latest_generation: u64) -> bool {
    latest_generation > requested_generation
}

#[derive(Clone, Default)]
pub struct WorkspaceTextSearchCancellationRuntime {
    latest_generations: Arc<Mutex<HashMap<String, u64>>>,
}

impl WorkspaceTextSearchCancellationRuntime {
    pub fn register_generation(&self, root_path: &str, generation: u64) -> Result<(), String> {
        let mut generations = self
            .latest_generations
            .lock()
            .map_err(|_| "Workspace text search cancellation lock poisoned".to_string())?;
        let latest = generations
            .entry(root_path.to_string())
            .or_insert(generation);
        *latest = (*latest).max(generation);
        Ok(())
    }

    pub fn is_generation_stale(&self, root_path: &str, generation: u64) -> Result<bool, String> {
        let generations = self
            .latest_generations
            .lock()
            .map_err(|_| "Workspace text search cancellation lock poisoned".to_string())?;
        Ok(generations
            .get(root_path)
            .is_some_and(|latest| is_text_search_generation_stale(generation, *latest)))
    }
}
