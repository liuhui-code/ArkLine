use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_content_refresh_service::update_workspace_content_at_generation;
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_fingerprints,
};
use crate::services::workspace_index_persistence_service::persist_incremental_deep_index_state_with_priority;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

impl WorkspaceIndexRuntime {
    #[allow(dead_code)]
    pub fn update_workspace_deep_layer(
        &self,
        root_path: &str,
        changed_paths: &[String],
        removed_paths: &[String],
    ) -> Result<WorkspaceIndexState, String> {
        self.update_workspace_deep_layer_with_priority(
            root_path,
            changed_paths,
            removed_paths,
            WorkspaceIndexTaskPriority::FullRefresh,
        )
    }

    pub fn update_workspace_deep_layer_with_priority(
        &self,
        root_path: &str,
        changed_paths: &[String],
        removed_paths: &[String],
        priority: WorkspaceIndexTaskPriority,
    ) -> Result<WorkspaceIndexState, String> {
        let state = self.get_index_state(root_path)?;
        update_workspace_content_at_generation(
            root_path,
            changed_paths,
            removed_paths,
            state.indexed_at.unwrap_or_default() as u64,
        )?;
        persist_incremental_deep_index_state_with_priority(
            root_path,
            &state,
            changed_paths,
            removed_paths,
            priority,
        )?;
        update_file_fingerprints(
            root_path,
            changed_paths,
            state.indexed_at.unwrap_or_default() as u64,
        )?;
        remove_file_fingerprints(root_path, removed_paths)?;
        Ok(state)
    }
}
