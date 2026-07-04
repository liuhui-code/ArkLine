use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_content_index_service::update_workspace_content;
use crate::services::workspace_index_persistence_service::persist_incremental_deep_index_state;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

impl WorkspaceIndexRuntime {
    pub fn update_workspace_deep_layer(
        &self,
        root_path: &str,
        changed_paths: &[String],
        removed_paths: &[String],
    ) -> Result<WorkspaceIndexState, String> {
        let state = self.get_index_state(root_path)?;
        update_workspace_content(root_path, changed_paths, removed_paths)?;
        persist_incremental_deep_index_state(root_path, &state, changed_paths, removed_paths)?;
        Ok(state)
    }
}
