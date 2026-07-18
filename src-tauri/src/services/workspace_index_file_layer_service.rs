use std::collections::HashSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_fingerprints,
};
use crate::services::workspace_file_search_index_service::WorkspaceFileSearchIndex;
use crate::services::workspace_index_persistence_service::persist_incremental_file_symbol_state;
use crate::services::workspace_index_service::{IndexedWorkspace, WorkspaceIndexRuntime};
use crate::services::workspace_symbol_index_service::update_workspace_symbols_with_delta;

impl WorkspaceIndexRuntime {
    pub fn update_workspace_file_symbol_layer(
        &self,
        root_path: &str,
        added_paths: &[String],
        removed_paths: &[String],
    ) -> Result<WorkspaceIndexState, String> {
        let normalized_root = normalize_index_path(root_path);
        let existing_workspace = {
            let workspaces = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?;
            workspaces.get(&normalized_root).cloned()
        };
        let mut workspace = if let Some(workspace) = existing_workspace {
            workspace
        } else {
            restore_minimal_workspace(self, root_path)?
        };

        let removed = removed_paths
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<HashSet<_>>();
        workspace
            .state
            .file_paths
            .retain(|path| !removed.contains(path));

        let mut path_set = workspace
            .state
            .file_paths
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        for path in added_paths.iter().map(|path| normalize_index_path(path)) {
            if path_set.insert(path.clone()) {
                workspace.state.file_paths.push(path);
            }
        }

        workspace.state.file_paths.sort();
        workspace.file_search_index = Arc::new(WorkspaceFileSearchIndex::new(
            workspace.state.file_paths.iter().cloned(),
        ));
        let symbol_update = update_workspace_symbols_with_delta(
            &workspace.state.symbols,
            added_paths,
            removed_paths,
        );
        workspace.state.symbols = symbol_update.symbols;
        workspace.state.indexed_at = Some(now_epoch_ms()?);

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        update_file_fingerprints(root_path, added_paths, now_epoch_ms()? as u64)?;
        remove_file_fingerprints(root_path, removed_paths)?;
        persist_incremental_file_symbol_state(
            root_path,
            &workspace.state,
            &symbol_update.changed_symbols,
            added_paths,
            removed_paths,
        )?;

        Ok(workspace.state)
    }
}

fn restore_minimal_workspace(
    runtime: &WorkspaceIndexRuntime,
    root_path: &str,
) -> Result<IndexedWorkspace, String> {
    let state = runtime.get_index_state(root_path)?;
    Ok(IndexedWorkspace {
        file_search_index: Arc::new(WorkspaceFileSearchIndex::new(
            state.file_paths.iter().cloned(),
        )),
        state,
    })
}

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
