use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::models::workspace::{
    WorkspaceIndexRefreshResult, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceSearchCandidate, WorkspaceSnapshot,
};
use crate::services::workspace_content_refresh_service::{
    index_workspace_content_at_generation, update_workspace_content_at_generation,
};
use crate::services::workspace_dependency_graph_service::{
    expand_changed_paths, DependencyExpansion,
};
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_fingerprints,
};
use crate::services::workspace_file_search_index_service::WorkspaceFileSearchIndex;
use crate::services::workspace_index_persistence_service::{
    persist_catalog_cache, persist_incremental_index_state_with_priority,
    restore_catalog_cache_state,
};
use crate::services::workspace_index_refresh_path_plan_service::plan_workspace_index_refresh_paths;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;
use crate::services::workspace_index_snapshot_state_service::{
    build_snapshot_index_state, snapshot_file_paths,
};
use crate::services::workspace_index_state_defaults_service::empty_state;
use crate::services::workspace_search_ranking_service::sort_search_everywhere_candidates;
use crate::services::workspace_service::scan_workspace;
use crate::services::workspace_symbol_index_service::{
    index_workspace_symbols, query_index_symbols, update_workspace_symbols_with_delta,
};

const INDEX_DEPENDENCY_EXPANSION_LIMIT: usize = 500;

#[derive(Debug, Clone)]
pub(crate) struct IndexedWorkspace {
    pub(crate) state: WorkspaceIndexState,
    pub(crate) file_search_index: Arc<WorkspaceFileSearchIndex>,
}

#[derive(Debug, Default, Clone)]
pub struct WorkspaceIndexRuntime {
    pub(crate) workspaces: Arc<Mutex<HashMap<String, IndexedWorkspace>>>,
}

impl WorkspaceIndexRuntime {
    pub fn index_workspace_snapshot(
        &self,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<WorkspaceIndexState, String> {
        migrate_workspace_index_schema(&snapshot.root_path)?;
        let root_path = normalize_index_path(&snapshot.root_path);
        let file_paths = snapshot_file_paths(snapshot);
        let symbols = index_workspace_symbols(&file_paths);
        let state = build_snapshot_index_state(snapshot, now_epoch_ms()?, symbols.clone());
        let indexed = IndexedWorkspace {
            file_search_index: Arc::new(WorkspaceFileSearchIndex::new(
                state.file_paths.iter().cloned(),
            )),
            state: state.clone(),
        };

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        index_workspace_content_at_generation(
            &snapshot.root_path,
            &state.file_paths,
            state.indexed_at.unwrap_or_default() as u64,
        )?;
        persist_catalog_cache(snapshot, &state)?;
        update_file_fingerprints(
            &snapshot.root_path,
            &state.file_paths,
            now_epoch_ms()? as u64,
        )?;

        Ok(state)
    }

    pub fn index_workspace_snapshot_for_open(
        &self,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<WorkspaceIndexState, String> {
        let total_start = Instant::now();
        let root_path = normalize_index_path(&snapshot.root_path);
        let state_start = Instant::now();
        let state = build_snapshot_index_state(snapshot, now_epoch_ms()?, Vec::new());
        let state_duration = state_start.elapsed();
        let search_start = Instant::now();
        let file_search_index = Arc::new(WorkspaceFileSearchIndex::new(
            state.file_paths.iter().cloned(),
        ));
        let search_duration = search_start.elapsed();
        let indexed = IndexedWorkspace {
            file_search_index,
            state: state.clone(),
        };

        let publish_start = Instant::now();
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        if profile_index_open_enabled() {
            eprintln!(
                "Workspace open index stages: state={state_duration:?}, search={search_duration:?}, publish={:?}, total={:?}",
                publish_start.elapsed(),
                total_start.elapsed()
            );
        }
        Ok(state)
    }

    pub fn refresh_workspace_index(&self, root_path: &str) -> Result<WorkspaceIndexState, String> {
        let snapshot = scan_workspace(Path::new(root_path))?;
        self.index_workspace_snapshot(&snapshot)
    }

    pub fn refresh_workspace_index_with_changes(
        &self,
        root_path: &str,
    ) -> Result<WorkspaceIndexRefreshResult, String> {
        self.refresh_workspace_index_for_changed_paths(root_path, &[])
    }

    pub fn refresh_workspace_index_for_changed_paths(
        &self,
        root_path: &str,
        changed_paths: &[String],
    ) -> Result<WorkspaceIndexRefreshResult, String> {
        self.refresh_workspace_index_for_changed_paths_with_priority(
            root_path,
            changed_paths,
            WorkspaceIndexTaskPriority::ChangedFiles,
        )
    }

    pub fn refresh_workspace_index_for_changed_paths_with_priority(
        &self,
        root_path: &str,
        changed_paths: &[String],
        priority: WorkspaceIndexTaskPriority,
    ) -> Result<WorkspaceIndexRefreshResult, String> {
        let previous_state = self.get_index_state(root_path)?;
        let snapshot = scan_workspace(Path::new(root_path))?;
        let current_snapshot_paths = snapshot
            .files
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<Vec<_>>();
        let path_plan = plan_workspace_index_refresh_paths(
            &previous_state.file_paths,
            &current_snapshot_paths,
            changed_paths,
        );
        let dependency_paths = expand_changed_paths(
            root_path,
            &path_plan.dependency_seed_paths,
            &path_plan.current_paths,
            INDEX_DEPENDENCY_EXPANSION_LIMIT,
        )?;
        let mut content_paths = match dependency_paths {
            DependencyExpansion::Expanded(paths) => paths,
            DependencyExpansion::LimitExceeded => {
                let state = self.index_workspace_snapshot(&snapshot)?;
                return Ok(WorkspaceIndexRefreshResult {
                    state,
                    changed: true,
                    added_paths: path_plan.added_paths,
                    removed_paths: path_plan.removed_paths,
                });
            }
        };
        content_paths.extend(path_plan.direct_content_paths.clone());
        content_paths.extend(path_plan.added_paths.clone());
        content_paths.sort();
        content_paths.dedup();

        let changed = !path_plan.added_paths.is_empty()
            || !path_plan.removed_paths.is_empty()
            || !content_paths.is_empty();
        let state = if path_plan.previous_paths.is_empty() {
            self.index_workspace_snapshot(&snapshot)?
        } else {
            self.replace_workspace_index_from_snapshot(
                &snapshot,
                &previous_state.symbols,
                &content_paths,
                &path_plan.removed_paths,
                priority,
            )?
        };
        if !path_plan.previous_paths.is_empty() {
            update_workspace_content_at_generation(
                root_path,
                &content_paths,
                &path_plan.removed_paths,
                state.indexed_at.unwrap_or_default() as u64,
            )?;
            update_file_fingerprints(root_path, &content_paths, now_epoch_ms()? as u64)?;
            remove_file_fingerprints(root_path, &path_plan.removed_paths)?;
        }

        Ok(WorkspaceIndexRefreshResult {
            state,
            changed,
            added_paths: path_plan.added_paths,
            removed_paths: path_plan.removed_paths,
        })
    }

    pub fn get_index_state(&self, root_path: &str) -> Result<WorkspaceIndexState, String> {
        let normalized_root = normalize_index_path(root_path);
        let existing_state = {
            let workspaces = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?;
            workspaces
                .get(&normalized_root)
                .map(|workspace| workspace.state.clone())
        };
        if let Some(state) = existing_state {
            return Ok(state);
        }

        self.restore_catalog_cache(root_path)
            .map(|workspace| workspace.state)
            .or_else(|error| {
                if error.contains("does not exist") {
                    Ok(empty_state())
                } else {
                    Err(error)
                }
            })
    }

    pub fn clear_workspace_index_state(&self, root_path: &str) -> Result<(), String> {
        let normalized_root = normalize_index_path(root_path);
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .remove(&normalized_root);
        Ok(())
    }

    pub fn query_quick_open(
        &self,
        root_path: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSearchCandidate>, String> {
        let (file_search_index, status) = self.file_search_index_for_query(root_path)?;
        let freshness = match status {
            WorkspaceIndexStatus::Partial => "partial",
            WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => "stale",
            _ => "ready",
        };
        Ok(file_search_index.query(query, limit, freshness))
    }

    pub fn query_search_everywhere(
        &self,
        root_path: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSearchCandidate>, String> {
        let workspace = self.workspace_for_query(root_path)?;
        let mut candidates = self.query_quick_open(root_path, query, limit)?;
        candidates.extend(query_index_symbols(&workspace.state.symbols, query, limit));
        sort_search_everywhere_candidates(&mut candidates, limit);
        Ok(candidates)
    }

    pub fn update_workspace_files(
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
            self.restore_catalog_cache(root_path)?
        };

        let removed = removed_paths
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<HashSet<_>>();
        workspace
            .state
            .file_paths
            .retain(|path| !removed.contains(path));

        let mut workspace_path_set = workspace
            .state
            .file_paths
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        for path in added_paths.iter().map(|path| normalize_index_path(path)) {
            if workspace_path_set.insert(path.clone()) {
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
        update_workspace_content_at_generation(
            root_path,
            added_paths,
            removed_paths,
            workspace.state.indexed_at.unwrap_or_default() as u64,
        )?;
        update_file_fingerprints(root_path, added_paths, now_epoch_ms()? as u64)?;
        remove_file_fingerprints(root_path, removed_paths)?;
        persist_incremental_index_state_with_priority(
            root_path,
            &workspace.state,
            &symbol_update.changed_symbols,
            added_paths,
            removed_paths,
            WorkspaceIndexTaskPriority::ChangedFiles,
        )?;

        Ok(workspace.state)
    }

    fn restore_catalog_cache(&self, root_path: &str) -> Result<IndexedWorkspace, String> {
        let state = restore_catalog_cache_state(root_path)?;
        let root_key = state
            .root_path
            .clone()
            .unwrap_or_else(|| normalize_index_path(root_path));
        let workspace = IndexedWorkspace {
            file_search_index: Arc::new(WorkspaceFileSearchIndex::new(
                state.file_paths.iter().cloned(),
            )),
            state,
        };
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_key, workspace.clone());

        Ok(workspace)
    }

    fn replace_workspace_index_from_snapshot(
        &self,
        snapshot: &WorkspaceSnapshot,
        previous_symbols: &[crate::models::workspace::WorkspaceIndexedSymbol],
        changed_paths: &[String],
        removed_paths: &[String],
        priority: WorkspaceIndexTaskPriority,
    ) -> Result<WorkspaceIndexState, String> {
        let root_path = normalize_index_path(&snapshot.root_path);
        let symbol_update =
            update_workspace_symbols_with_delta(previous_symbols, changed_paths, removed_paths);
        let symbols = symbol_update.symbols;
        let state = build_snapshot_index_state(snapshot, now_epoch_ms()?, symbols.clone());
        let indexed = IndexedWorkspace {
            file_search_index: Arc::new(WorkspaceFileSearchIndex::new(
                state.file_paths.iter().cloned(),
            )),
            state: state.clone(),
        };

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        persist_incremental_index_state_with_priority(
            &snapshot.root_path,
            &state,
            &symbol_update.changed_symbols,
            changed_paths,
            removed_paths,
            priority,
        )?;

        Ok(state)
    }

    fn workspace_for_query(&self, root_path: &str) -> Result<IndexedWorkspace, String> {
        let normalized_root = normalize_index_path(root_path);
        let existing_workspace = {
            let workspaces = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?;
            workspaces.get(&normalized_root).cloned()
        };
        if let Some(workspace) = existing_workspace {
            return Ok(workspace);
        }

        match self.restore_catalog_cache(root_path) {
            Ok(workspace) => Ok(workspace),
            Err(error) if error.contains("does not exist") => Ok(IndexedWorkspace {
                state: empty_state(),
                file_search_index: Arc::new(WorkspaceFileSearchIndex::default()),
            }),
            Err(error) => Err(error),
        }
    }

    fn file_search_index_for_query(
        &self,
        root_path: &str,
    ) -> Result<(Arc<WorkspaceFileSearchIndex>, WorkspaceIndexStatus), String> {
        let normalized_root = normalize_index_path(root_path);
        let existing = {
            let workspaces = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?;
            workspaces.get(&normalized_root).map(|workspace| {
                (
                    workspace.file_search_index.clone(),
                    workspace.state.status.clone(),
                )
            })
        };
        if let Some(existing) = existing {
            return Ok(existing);
        }
        match self.restore_catalog_cache(root_path) {
            Ok(restored) => Ok((restored.file_search_index, restored.state.status.clone())),
            Err(error) if error.contains("does not exist") => {
                let workspace = IndexedWorkspace {
                    state: empty_state(),
                    file_search_index: Arc::new(WorkspaceFileSearchIndex::default()),
                };
                let result = (
                    workspace.file_search_index.clone(),
                    workspace.state.status.clone(),
                );
                self.workspaces
                    .lock()
                    .map_err(|_| "Workspace index lock poisoned".to_string())?
                    .insert(normalized_root, workspace);
                Ok(result)
            }
            Err(error) => Err(error),
        }
    }
}

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

fn profile_index_open_enabled() -> bool {
    std::env::var("ARKLINE_PROFILE_INDEX_OPEN")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
