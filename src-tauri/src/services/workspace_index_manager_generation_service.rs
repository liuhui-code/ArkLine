use crate::services::workspace_discovery_store_service::load_discovery_generation;
use crate::services::workspace_index_task_journal_service::load_latest_task_generation;

use super::WorkspaceIndexManagerRuntime;

impl WorkspaceIndexManagerRuntime {
    pub(super) fn synchronize_scheduler_generation(&self, root_path: &str) -> Result<(), String> {
        let generation = load_latest_task_generation(root_path)?
            .unwrap_or_default()
            .max(load_discovery_generation(root_path)?.unwrap_or_default());
        self.scheduler
            .lock()
            .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
            .advance_generation_to(generation);
        Ok(())
    }
}
