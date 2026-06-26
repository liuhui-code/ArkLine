use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::models::workspace::{
    WorkspaceIndexRefreshResult, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceSearchCandidate, WorkspaceSnapshot,
};
use crate::services::workspace_service::scan_workspace;

#[derive(Debug, Clone)]
struct IndexedWorkspace {
    state: WorkspaceIndexState,
    file_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCatalogCache {
    schema_version: u32,
    state: WorkspaceIndexState,
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
            indexed_at: Some(now_epoch_ms()?),
            partial_reason: build_partial_reason(snapshot),
        };
        let indexed = IndexedWorkspace {
            state: state.clone(),
            file_paths: state.file_paths.clone(),
        };

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_path, indexed);
        persist_catalog_cache(snapshot, &state)?;

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
        let previous_paths = self
            .get_index_state(root_path)?
            .file_paths
            .into_iter()
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

        let state = self.index_workspace_snapshot(&snapshot)?;

        Ok(WorkspaceIndexRefreshResult {
            state,
            changed: !added_paths.is_empty() || !removed_paths.is_empty(),
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
        let normalized_root = normalize_index_path(root_path);
        let existing_workspace = {
            let workspaces = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?;
            workspaces.get(&normalized_root).cloned()
        };
        let workspace = if let Some(workspace) = existing_workspace {
            workspace
        } else {
            match self.restore_catalog_cache(root_path) {
                Ok(workspace) => workspace,
                Err(error) if error.contains("does not exist") => return Ok(Vec::new()),
                Err(error) => return Err(error),
            }
        };
        let freshness = match workspace.state.status {
            WorkspaceIndexStatus::Partial => "partial",
            WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => "stale",
            _ => "ready",
        };

        Ok(rank_paths(&workspace.file_paths, query, limit)
            .into_iter()
            .map(|(path, score)| WorkspaceSearchCandidate {
                id: format!("file:{path}"),
                source: "file".to_string(),
                kind: "file".to_string(),
                title: file_name(&path),
                subtitle: path.clone(),
                path: Some(path),
                score,
                freshness: freshness.to_string(),
            })
            .collect())
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
        workspace.state.indexed_at = Some(now_epoch_ms()?);

        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(normalized_root, workspace.clone());
        persist_index_state(root_path, &workspace.state)?;

        Ok(workspace.state)
    }

    fn restore_catalog_cache(&self, root_path: &str) -> Result<IndexedWorkspace, String> {
        if let Ok(state) = restore_sqlite_catalog_cache(root_path) {
            let root_key = state
                .root_path
                .clone()
                .unwrap_or_else(|| normalize_index_path(root_path));
            let workspace = IndexedWorkspace {
                file_paths: state.file_paths.clone(),
                state,
            };
            self.workspaces
                .lock()
                .map_err(|_| "Workspace index lock poisoned".to_string())?
                .insert(root_key, workspace.clone());

            return Ok(workspace);
        }

        let cache_path = catalog_cache_path(root_path);
        if !cache_path.exists() {
            return Err(format!(
                "Workspace catalog cache does not exist: {}",
                cache_path.display()
            ));
        }

        let content = fs::read_to_string(&cache_path).map_err(|error| error.to_string())?;
        let cache: WorkspaceCatalogCache =
            serde_json::from_str(&content).map_err(|error| error.to_string())?;
        if cache.schema_version != 1 {
            return Err(format!(
                "Unsupported workspace catalog cache schema: {}",
                cache.schema_version
            ));
        }

        let root_key = cache
            .state
            .root_path
            .clone()
            .unwrap_or_else(|| normalize_index_path(root_path));
        let workspace = IndexedWorkspace {
            file_paths: cache.state.file_paths.clone(),
            state: cache.state,
        };
        self.workspaces
            .lock()
            .map_err(|_| "Workspace index lock poisoned".to_string())?
            .insert(root_key, workspace.clone());

        Ok(workspace)
    }
}

fn empty_state() -> WorkspaceIndexState {
    WorkspaceIndexState {
        status: WorkspaceIndexStatus::Empty,
        root_path: None,
        file_paths: Vec::new(),
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

fn persist_catalog_cache(
    snapshot: &WorkspaceSnapshot,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    if !Path::new(&snapshot.root_path).is_dir() {
        return Ok(());
    }

    let cache_path = catalog_cache_path(&snapshot.root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace catalog cache path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&WorkspaceCatalogCache {
        schema_version: 1,
        state: state.clone(),
    })
    .map_err(|error| error.to_string())?;

    fs::write(cache_path, content)
        .map_err(|error| error.to_string())
        .and_then(|_| persist_sqlite_index_state(&snapshot.root_path, state))
}

fn persist_index_state(root_path: &str, state: &WorkspaceIndexState) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let cache_path = catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace catalog cache path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&WorkspaceCatalogCache {
        schema_version: 1,
        state: state.clone(),
    })
    .map_err(|error| error.to_string())?;

    fs::write(cache_path, content).map_err(|error| error.to_string())?;
    persist_sqlite_index_state(root_path, state)
}

fn catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.json")
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn persist_sqlite_index_state(root_path: &str, state: &WorkspaceIndexState) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite catalog cache path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let connection = Connection::open(&cache_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_catalog (
                root_path text primary key,
                schema_version integer not null,
                state_json text not null,
                updated_at integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;

    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let state_json = serde_json::to_string(state).map_err(|error| error.to_string())?;
    let updated_at = now_epoch_ms()? as i64;

    connection
        .execute(
            "insert into workspace_catalog (root_path, schema_version, state_json, updated_at)
             values (?1, 1, ?2, ?3)
             on conflict(root_path) do update set
                schema_version = excluded.schema_version,
                state_json = excluded.state_json,
                updated_at = excluded.updated_at",
            params![root_key, state_json, updated_at],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn restore_sqlite_catalog_cache(root_path: &str) -> Result<WorkspaceIndexState, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Err(format!(
            "Workspace SQLite catalog cache does not exist: {}",
            cache_path.display()
        ));
    }

    let connection = Connection::open(&cache_path).map_err(|error| error.to_string())?;
    let root_key = normalize_index_path(root_path);
    let (schema_version, state_json): (i64, String) = connection
        .query_row(
            "select schema_version, state_json
             from workspace_catalog
             where root_path = ?1
             order by updated_at desc
             limit 1",
            params![root_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;

    if schema_version != 1 {
        return Err(format!(
            "Unsupported workspace SQLite catalog cache schema: {schema_version}"
        ));
    }

    serde_json::from_str(&state_json).map_err(|error| error.to_string())
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

fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
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

fn rank_paths(paths: &[String], query: &str, limit: usize) -> Vec<(String, f64)> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return paths
            .iter()
            .take(limit)
            .map(|path| (path.clone(), 0.0))
            .collect();
    }

    let mut ranked = paths
        .iter()
        .filter_map(|path| score_path(path, &trimmed).map(|score| (path.clone(), score)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.truncate(limit);
    ranked
}

fn score_path(path: &str, query: &str) -> Option<f64> {
    let lower_path = path.to_lowercase();
    let file_name = lower_path.rsplit(['\\', '/']).next().unwrap_or(&lower_path);
    let file_stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    let mut score = 0.0;
    let mut query_index = 0;
    let query_chars = query.chars().collect::<Vec<_>>();
    let mut run_length = 0.0;

    for character in lower_path.chars() {
        if query_index >= query_chars.len() {
            break;
        }

        if character != query_chars[query_index] {
            run_length = 0.0;
            continue;
        }

        score += 4.0;
        run_length += 1.0;
        query_index += 1;
        if run_length > 1.0 {
            score += 2.0;
        }
    }

    if query_index != query_chars.len() {
        return None;
    }

    if file_stem == query {
        score += 70.0;
    } else if file_name == query {
        score += 60.0;
    } else if file_name.starts_with(query) {
        score += 45.0;
    } else if file_name.contains(query) {
        score += 35.0;
    }

    if lower_path.contains(query) {
        score += 10.0;
    }

    Some(score - lower_path.len() as f64 * 0.01)
}

#[cfg(test)]
mod tests {
    use super::WorkspaceIndexRuntime;
    use crate::models::workspace::{WorkspaceScanSummary, WorkspaceSnapshot};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn snapshot(root_path: &str, truncated: bool) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.to_string(),
            files: vec![
                format!("{root_path}/entry/src/main/ets/pages/Index.ets"),
                format!("{root_path}/entry/src/main/ets/components/IndexCard.ets"),
                format!("{root_path}/AppScope/app.json5"),
            ],
            scan_summary: WorkspaceScanSummary {
                scanned_files: if truncated { 20_000 } else { 3 },
                skipped_entries: if truncated { 8 } else { 0 },
                truncated,
                exclude_rules: vec![".git".to_string(), "node_modules".to_string()],
            },
        }
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn indexes_workspace_snapshot_as_queryable_file_candidates() {
        let runtime = WorkspaceIndexRuntime::default();

        let state = runtime
            .index_workspace_snapshot(&snapshot("C:/samples/ArkDemo", false))
            .unwrap();
        let matches = runtime
            .query_quick_open("C:/samples/ArkDemo", "index", 8)
            .unwrap();

        assert_eq!(state.status.to_string(), "ready");
        assert_eq!(state.file_paths.len(), 3);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].title, "Index.ets");
        assert_eq!(matches[0].source, "file");
        assert_eq!(matches[0].freshness, "ready");
    }

    #[test]
    fn marks_index_and_candidates_partial_when_scan_was_truncated() {
        let runtime = WorkspaceIndexRuntime::default();

        let state = runtime
            .index_workspace_snapshot(&snapshot("C:/samples/ArkDemo", true))
            .unwrap();
        let matches = runtime
            .query_quick_open("C:/samples/ArkDemo", "index", 8)
            .unwrap();

        assert_eq!(state.status.to_string(), "partial");
        assert!(state.partial_reason.unwrap().contains("20,000"));
        assert_eq!(matches[0].freshness, "partial");
    }

    #[test]
    fn restores_workspace_catalog_from_persistent_cache() {
        let root = unique_temp_dir("workspace-index-cache");
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let writer = WorkspaceIndexRuntime::default();
        writer
            .index_workspace_snapshot(&snapshot(&root_path, false))
            .unwrap();

        let cache_file = root
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.json");
        assert!(cache_file.exists());

        let reader = WorkspaceIndexRuntime::default();
        let state = reader.get_index_state(&root_path).unwrap();
        let matches = reader.query_quick_open(&root_path, "index", 8).unwrap();

        assert_eq!(state.status.to_string(), "ready");
        assert_eq!(state.file_paths.len(), 3);
        assert_eq!(matches[0].title, "Index.ets");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_workspace_catalog_from_sqlite_cache() {
        let root = unique_temp_dir("workspace-index-sqlite-cache");
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let writer = WorkspaceIndexRuntime::default();
        writer
            .index_workspace_snapshot(&snapshot(&root_path, false))
            .unwrap();

        let sqlite_file = root
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite");
        assert!(sqlite_file.exists());

        let reader = WorkspaceIndexRuntime::default();
        let state = reader.get_index_state(&root_path).unwrap();
        let matches = reader.query_quick_open(&root_path, "app", 8).unwrap();

        assert_eq!(state.status.to_string(), "ready");
        assert_eq!(state.file_paths.len(), 3);
        assert_eq!(matches[0].title, "app.json5");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn updates_workspace_catalog_incrementally_and_persists_changes() {
        let root = unique_temp_dir("workspace-index-incremental");
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let writer = WorkspaceIndexRuntime::default();
        writer
            .index_workspace_snapshot(&snapshot(&root_path, false))
            .unwrap();

        let updater = WorkspaceIndexRuntime::default();
        let added = vec![format!("{root_path}/entry/src/main/ets/pages/About.ets")];
        let removed = vec![format!("{root_path}/entry/src/main/ets/pages/Index.ets")];
        let state = updater
            .update_workspace_files(&root_path, &added, &removed)
            .unwrap();

        assert!(state
            .file_paths
            .iter()
            .any(|path| path.ends_with("About.ets")));
        assert!(!state
            .file_paths
            .iter()
            .any(|path| path.ends_with("Index.ets")));

        let reader = WorkspaceIndexRuntime::default();
        let about_matches = reader.query_quick_open(&root_path, "about", 8).unwrap();
        let index_matches = reader.query_quick_open(&root_path, "index", 8).unwrap();

        assert_eq!(about_matches[0].title, "About.ets");
        assert!(!index_matches
            .iter()
            .any(|candidate| candidate.title == "Index.ets"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refreshes_workspace_catalog_from_filesystem_changes() {
        let root = unique_temp_dir("workspace-index-refresh");
        fs::create_dir_all(root.join("entry").join("src")).unwrap();
        fs::write(root.join("entry").join("src").join("Index.ets"), "").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let runtime = WorkspaceIndexRuntime::default();

        runtime.refresh_workspace_index(&root_path).unwrap();
        fs::write(root.join("entry").join("src").join("About.ets"), "").unwrap();
        fs::remove_file(root.join("entry").join("src").join("Index.ets")).unwrap();
        let state = runtime.refresh_workspace_index(&root_path).unwrap();

        assert_eq!(state.status.to_string(), "ready");
        assert!(state
            .file_paths
            .iter()
            .any(|path| path.ends_with("About.ets")));
        assert!(!state
            .file_paths
            .iter()
            .any(|path| path.ends_with("Index.ets")));

        let reader = WorkspaceIndexRuntime::default();
        let about_matches = reader.query_quick_open(&root_path, "about", 8).unwrap();

        assert_eq!(about_matches[0].title, "About.ets");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_added_and_removed_paths_when_refreshing_changed_workspace() {
        let root = unique_temp_dir("workspace-index-refresh-diff");
        fs::create_dir_all(root.join("entry").join("src")).unwrap();
        fs::write(root.join("entry").join("src").join("Index.ets"), "").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let runtime = WorkspaceIndexRuntime::default();

        let initial = runtime
            .refresh_workspace_index_with_changes(&root_path)
            .unwrap();
        assert!(initial.changed);
        assert_eq!(initial.added_paths.len(), 1);
        assert!(initial.removed_paths.is_empty());

        let unchanged = runtime
            .refresh_workspace_index_with_changes(&root_path)
            .unwrap();
        assert!(!unchanged.changed);
        assert!(unchanged.added_paths.is_empty());
        assert!(unchanged.removed_paths.is_empty());

        fs::write(root.join("entry").join("src").join("About.ets"), "").unwrap();
        fs::remove_file(root.join("entry").join("src").join("Index.ets")).unwrap();
        let changed = runtime
            .refresh_workspace_index_with_changes(&root_path)
            .unwrap();

        assert!(changed.changed);
        assert_eq!(changed.added_paths.len(), 1);
        assert_eq!(changed.removed_paths.len(), 1);
        assert!(changed.added_paths[0].ends_with("About.ets"));
        assert!(changed.removed_paths[0].ends_with("Index.ets"));

        fs::remove_dir_all(root).unwrap();
    }
}
