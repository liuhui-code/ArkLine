use std::collections::HashSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus};
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_catalog_fingerprints,
};
use crate::services::workspace_file_search_index_service::WorkspaceFileSearchIndex;
use crate::services::workspace_index_deep_refresh_catalog_service::complete_deep_refresh_catalog;
use crate::services::workspace_index_persistence_service::{
    persist_incremental_file_symbol_state, persist_index_metadata,
};
use crate::services::workspace_index_service::{IndexedWorkspace, WorkspaceIndexRuntime};
use crate::services::workspace_symbol_index_service::update_workspace_symbols_with_delta;

impl WorkspaceIndexRuntime {
    pub fn complete_workspace_incremental_deep_layer(
        &self,
        root_path: &str,
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

        workspace.state.status = if workspace.state.file_paths.is_empty() {
            WorkspaceIndexStatus::Empty
        } else {
            WorkspaceIndexStatus::Ready
        };
        workspace.state.partial_reason = None;
        persist_index_metadata(root_path, &workspace.state)?;
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        Ok(workspace.state)
    }

    pub fn degrade_workspace_deep_layer(
        &self,
        root_path: &str,
        reason: &str,
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

        workspace.state.status = WorkspaceIndexStatus::Partial;
        workspace.state.partial_reason = Some(reason.to_string());
        persist_index_metadata(root_path, &workspace.state)?;
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        Ok(workspace.state)
    }

    pub fn complete_workspace_deep_layer(
        &self,
        root_path: &str,
        catalog_generation: u64,
        task_key: &str,
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

        workspace.state.status = if workspace.state.file_paths.is_empty() {
            WorkspaceIndexStatus::Empty
        } else {
            WorkspaceIndexStatus::Ready
        };
        workspace.state.partial_reason = None;
        complete_deep_refresh_catalog(root_path, catalog_generation, task_key, &workspace.state)?;
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        Ok(workspace.state)
    }

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
        if workspace.state.file_paths.is_empty() {
            workspace.state.status = WorkspaceIndexStatus::Empty;
            workspace.state.partial_reason = None;
        } else {
            workspace.state.status = WorkspaceIndexStatus::Partial;
            workspace.state.partial_reason = Some(
                "File catalog is ready; background content and semantic indexing is pending"
                    .to_string(),
            );
        }
        workspace.state.indexed_at = Some(now_epoch_ms()?);

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        update_file_catalog_fingerprints(root_path, added_paths, now_epoch_ms()? as u64)?;
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
