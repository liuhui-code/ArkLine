use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{
    WorkspaceIndexRefreshResult, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceSearchCandidate, WorkspaceSnapshot,
};
use crate::services::workspace_content_index_service::{
    index_workspace_content, update_workspace_content,
};
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_fingerprints,
};
use crate::services::workspace_index_persistence_service::{
    persist_catalog_cache, persist_index_state, restore_catalog_cache_state,
};
use crate::services::workspace_search_ranking_service::{
    build_file_candidates, sort_search_everywhere_candidates,
};
use crate::services::workspace_service::scan_workspace;
use crate::services::workspace_symbol_index_service::{
    index_workspace_symbols, query_index_symbols, update_workspace_symbols,
};

#[derive(Debug, Clone)]
struct IndexedWorkspace {
    state: WorkspaceIndexState,
    file_paths: Vec<String>,
    symbols: Vec<crate::models::workspace::WorkspaceIndexedSymbol>,
}

#[derive(Debug, Default)]
pub struct WorkspaceIndexRuntime {
    workspaces: Mutex<HashMap<String, IndexedWorkspace>>,
}

impl WorkspaceIndexRuntime {
    pub fn index_workspace_snapshot(
        &self,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<WorkspaceIndexState, String> {
        let root_path = normalize_index_path(&snapshot.root_path);
        let status = if snapshot.scan_summary.truncated {
            WorkspaceIndexStatus::Partial
        } else {
            WorkspaceIndexStatus::Ready
        };
        let state = WorkspaceIndexState {
            status,
            root_path: Some(root_path.clone()),
            file_paths: snapshot
                .files
                .iter()
                .map(|path| normalize_index_path(path))
                .collect(),
            symbols: Vec::new(),
            indexed_at: Some(now_epoch_ms()?),
            partial_reason: build_partial_reason(snapshot),
        };
        let symbols = index_workspace_symbols(&state.file_paths);
        let state = WorkspaceIndexState {
            symbols: symbols.clone(),
            ..state
        };
        let indexed = IndexedWorkspace {
            state: state.clone(),
            file_paths: state.file_paths.clone(),
            symbols,
        };

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        index_workspace_content(&snapshot.root_path, &state.file_paths)?;
        persist_catalog_cache(snapshot, &state)?;
        update_file_fingerprints(
            &snapshot.root_path,
            &state.file_paths,
            now_epoch_ms()? as u64,
        )?;

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
        let previous_state = self.get_index_state(root_path)?;
        let previous_paths = previous_state
            .file_paths
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        let snapshot = scan_workspace(Path::new(root_path))?;
        let current_paths = snapshot
            .files
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<HashSet<_>>();
        let mut added_paths = current_paths
            .difference(&previous_paths)
            .cloned()
            .collect::<Vec<_>>();
        let mut removed_paths = previous_paths
            .difference(&current_paths)
            .cloned()
            .collect::<Vec<_>>();

        added_paths.sort();
        removed_paths.sort();

        let mut content_paths = changed_paths
            .iter()
            .map(|path| normalize_index_path(path))
            .filter(|path| current_paths.contains(path))
            .collect::<Vec<_>>();
        content_paths.extend(added_paths.clone());
        content_paths.sort();
        content_paths.dedup();

        let changed =
            !added_paths.is_empty() || !removed_paths.is_empty() || !content_paths.is_empty();
        let state = if previous_paths.is_empty() {
            self.index_workspace_snapshot(&snapshot)?
        } else {
            self.replace_workspace_index_from_snapshot(
                &snapshot,
                &previous_state.symbols,
                &content_paths,
                &removed_paths,
            )?
        };
        if !previous_paths.is_empty() {
            update_workspace_content(root_path, &content_paths, &removed_paths)?;
            update_file_fingerprints(root_path, &content_paths, now_epoch_ms()? as u64)?;
            remove_file_fingerprints(root_path, &removed_paths)?;
        }

        Ok(WorkspaceIndexRefreshResult {
            state,
            changed,
            added_paths,
            removed_paths,
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

    pub fn query_quick_open(
        &self,
        root_path: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSearchCandidate>, String> {
        let workspace = self.workspace_for_query(root_path)?;
        let freshness = match workspace.state.status {
            WorkspaceIndexStatus::Partial => "partial",
            WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => "stale",
            _ => "ready",
        };

        Ok(build_file_candidates(
            &workspace.file_paths,
            query,
            limit,
            freshness,
        ))
    }

    pub fn query_search_everywhere(
        &self,
        root_path: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSearchCandidate>, String> {
        let workspace = self.workspace_for_query(root_path)?;
        let mut candidates = self.query_quick_open(root_path, query, limit)?;
        candidates.extend(query_index_symbols(&workspace.symbols, query, limit));
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
        workspace.file_paths.retain(|path| !removed.contains(path));
        workspace
            .state
            .file_paths
            .retain(|path| !removed.contains(path));

        for path in added_paths.iter().map(|path| normalize_index_path(path)) {
            if !workspace.file_paths.contains(&path) {
                workspace.file_paths.push(path.clone());
            }
            if !workspace.state.file_paths.contains(&path) {
                workspace.state.file_paths.push(path);
            }
        }

        workspace.file_paths.sort();
        workspace.state.file_paths.sort();
        workspace.symbols =
            update_workspace_symbols(&workspace.symbols, added_paths, removed_paths);
        workspace.state.symbols = workspace.symbols.clone();
        workspace.state.indexed_at = Some(now_epoch_ms()?);

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        update_workspace_content(root_path, added_paths, removed_paths)?;
        update_file_fingerprints(root_path, added_paths, now_epoch_ms()? as u64)?;
        remove_file_fingerprints(root_path, removed_paths)?;
        persist_index_state(root_path, &workspace.state)?;

        Ok(workspace.state)
    }

    fn restore_catalog_cache(&self, root_path: &str) -> Result<IndexedWorkspace, String> {
        let state = restore_catalog_cache_state(root_path)?;
        let root_key = state
            .root_path
            .clone()
            .unwrap_or_else(|| normalize_index_path(root_path));
        let workspace = IndexedWorkspace {
            file_paths: state.file_paths.clone(),
            symbols: state.symbols.clone(),
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
    ) -> Result<WorkspaceIndexState, String> {
        let root_path = normalize_index_path(&snapshot.root_path);
        let status = if snapshot.scan_summary.truncated {
            WorkspaceIndexStatus::Partial
        } else {
            WorkspaceIndexStatus::Ready
        };
        let file_paths = snapshot
            .files
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<Vec<_>>();
        let symbols = update_workspace_symbols(previous_symbols, changed_paths, removed_paths);
        let state = WorkspaceIndexState {
            status,
            root_path: Some(root_path.clone()),
            file_paths: file_paths.clone(),
            symbols: symbols.clone(),
            indexed_at: Some(now_epoch_ms()?),
            partial_reason: build_partial_reason(snapshot),
        };
        let indexed = IndexedWorkspace {
            state: state.clone(),
            file_paths,
            symbols,
        };

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        persist_index_state(&snapshot.root_path, &state)?;

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
                file_paths: Vec::new(),
                symbols: Vec::new(),
            }),
            Err(error) => Err(error),
        }
    }
}

fn empty_state() -> WorkspaceIndexState {
    WorkspaceIndexState {
        status: WorkspaceIndexStatus::Empty,
        root_path: None,
        file_paths: Vec::new(),
        symbols: Vec::new(),
        indexed_at: None,
        partial_reason: None,
    }
}

fn build_partial_reason(snapshot: &WorkspaceSnapshot) -> Option<String> {
    if !snapshot.scan_summary.truncated {
        return None;
    }

    Some(format!(
        "Partial workspace results: scan stopped at {} files; excluded {} generated/dependency entries.",
        format_count(snapshot.scan_summary.scanned_files),
        format_count(snapshot.scan_summary.skipped_entries),
    ))
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

fn format_count(value: usize) -> String {
    let digits = value.to_string();
    let mut formatted = String::new();
    for (index, character) in digits.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            formatted.push(',');
        }
        formatted.push(character);
    }
    formatted.chars().rev().collect()
}
