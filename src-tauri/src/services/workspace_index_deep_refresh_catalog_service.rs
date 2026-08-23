use std::path::Path;

use rusqlite::{params, OptionalExtension};

use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_file_identity_service::ensure_workspace_file_id;
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_entity_persistence_service::persist_metadata_row;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexDeepRefreshCatalogPage {
    pub catalog_generation: u64,
    pub files: Vec<WorkspaceIndexDeepRefreshCatalogFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexDeepRefreshCatalogFile {
    pub file_id: i64,
    pub path: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexDeepRefreshCatalogLifecycle {
    pub active_generation: Option<u64>,
    pub active_file_count: usize,
    pub terminal_catalog_count: usize,
    pub checkpoint_count: usize,
}

pub(crate) fn create_deep_refresh_catalog(
    root_path: &str,
    catalog_generation: u64,
    paths: &[String],
) -> Result<usize, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(0);
    }
    let root_key = normalize_root_path(root_path);
    let paths = normalized_unique_paths(paths);
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "update workspace_index_deep_refresh_catalogs
                 set state = 'superseded', superseded_at = strftime('%s','now') * 1000
                 where root_path = ?1 and state = 'active' and catalog_generation <> ?2",
                params![root_key, catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "delete from workspace_index_deep_refresh_checkpoints
                 where root_path = ?1 and catalog_generation <> ?2",
                params![root_key, catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "insert into workspace_index_deep_refresh_catalogs (
                    root_path, catalog_generation, state, created_at, superseded_at
                 ) values (?1, ?2, 'active', strftime('%s','now') * 1000, null)
                 on conflict(root_path, catalog_generation) do update set
                    state = 'active', superseded_at = null",
                params![root_key, catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "delete from workspace_index_deep_refresh_catalog_files
                 where root_path = ?1 and catalog_generation = ?2",
                params![root_key, catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        let mut statement = transaction
            .prepare(
                "insert into workspace_index_deep_refresh_catalog_files (
                    root_path, catalog_generation, file_id, path
                 ) values (?1, ?2, ?3, ?4)",
            )
            .map_err(|error| error.to_string())?;
        for path in &paths {
            let file_id = ensure_workspace_file_id(transaction, &root_key, path)?;
            statement
                .execute(params![root_key, catalog_generation as i64, file_id, path])
                .map_err(|error| error.to_string())?;
        }
        Ok(paths.len())
    })
}

pub(crate) fn is_deep_refresh_catalog_active(
    root_path: &str,
    catalog_generation: u64,
) -> Result<bool, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(false);
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(false);
    };
    connection
        .query_row(
            "select state = 'active' from workspace_index_deep_refresh_catalogs
             where root_path = ?1 and catalog_generation = ?2",
            params![normalize_root_path(root_path), catalog_generation as i64],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| error.to_string())
}

pub(crate) fn load_deep_refresh_catalog_lifecycle(
    root_path: &str,
) -> Result<WorkspaceIndexDeepRefreshCatalogLifecycle, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(WorkspaceIndexDeepRefreshCatalogLifecycle::default());
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(WorkspaceIndexDeepRefreshCatalogLifecycle::default());
    };
    let root_key = normalize_root_path(root_path);
    let (active_generation, terminal_catalog_count) = connection
        .query_row(
            "select max(case when state = 'active' then catalog_generation end),
                    sum(case when state <> 'active' then 1 else 0 end)
             from workspace_index_deep_refresh_catalogs where root_path = ?1",
            params![root_key],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let active_file_count = connection
        .query_row(
            "select count(*) from workspace_index_deep_refresh_catalog_files
             where root_path = ?1 and catalog_generation = ?2",
            params![root_key, active_generation.unwrap_or_default()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let checkpoint_count = connection
        .query_row(
            "select count(*) from workspace_index_deep_refresh_checkpoints where root_path = ?1",
            params![root_key],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(WorkspaceIndexDeepRefreshCatalogLifecycle {
        active_generation: active_generation.map(|value| value as u64),
        active_file_count: active_file_count as usize,
        terminal_catalog_count: terminal_catalog_count.unwrap_or_default() as usize,
        checkpoint_count: checkpoint_count as usize,
    })
}

pub(crate) fn prune_terminal_deep_refresh_catalogs(
    root_path: &str,
    older_than_ms: i64,
) -> Result<usize, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(0);
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        let root_key = normalize_root_path(root_path);
        let mut statement = transaction
            .prepare(
                "select catalog_generation from workspace_index_deep_refresh_catalogs
                 where root_path = ?1 and state <> 'active' and created_at < ?2",
            )
            .map_err(|error| error.to_string())?;
        let generations = statement
            .query_map(params![root_key, older_than_ms], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        for generation in &generations {
            transaction
                .execute(
                    "delete from workspace_index_deep_refresh_checkpoints
                     where root_path = ?1 and catalog_generation = ?2",
                    params![root_key, generation],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "delete from workspace_index_deep_refresh_catalog_files
                     where root_path = ?1 and catalog_generation = ?2",
                    params![root_key, generation],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "delete from workspace_index_deep_refresh_catalogs
                     where root_path = ?1 and catalog_generation = ?2",
                    params![root_key, generation],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(generations.len())
    })
}

pub(crate) fn load_deep_refresh_catalog_page(
    root_path: &str,
    catalog_generation: u64,
    after_file_id: Option<i64>,
    limit: usize,
) -> Result<Option<WorkspaceIndexDeepRefreshCatalogPage>, String> {
    load_deep_refresh_catalog_batch(root_path, catalog_generation, after_file_id, None, limit)
}

pub(crate) fn load_deep_refresh_catalog_batch(
    root_path: &str,
    catalog_generation: u64,
    after_file_id: Option<i64>,
    up_to_file_id: Option<i64>,
    limit: usize,
) -> Result<Option<WorkspaceIndexDeepRefreshCatalogPage>, String> {
    if !Path::new(root_path).is_dir() || limit == 0 {
        return Ok(None);
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(None);
    };
    let root_key = normalize_root_path(root_path);
    let is_active = connection
        .query_row(
            "select state = 'active' from workspace_index_deep_refresh_catalogs
             where root_path = ?1 and catalog_generation = ?2",
            params![root_key, catalog_generation as i64],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    if !is_active {
        return Ok(None);
    }
    let mut statement = connection
        .prepare(
            "select file_id, path
             from workspace_index_deep_refresh_catalog_files
             where root_path = ?1 and catalog_generation = ?2
               and file_id > ?3
               and (?4 is null or file_id <= ?4)
             order by file_id
             limit ?5",
        )
        .map_err(|error| error.to_string())?;
    let files = statement
        .query_map(
            params![
                root_key,
                catalog_generation as i64,
                after_file_id.unwrap_or(0),
                up_to_file_id,
                limit as i64,
            ],
            |row| {
                Ok(WorkspaceIndexDeepRefreshCatalogFile {
                    file_id: row.get(0)?,
                    path: row.get(1)?,
                })
            },
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(Some(WorkspaceIndexDeepRefreshCatalogPage {
        catalog_generation,
        files,
    }))
}

pub(crate) fn supersede_deep_refresh_catalog(
    root_path: &str,
    catalog_generation: u64,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "update workspace_index_deep_refresh_catalogs
                 set state = 'superseded', superseded_at = strftime('%s','now') * 1000
                 where root_path = ?1 and catalog_generation = ?2 and state = 'active'",
                params![normalize_root_path(root_path), catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn complete_deep_refresh_catalog(
    root_path: &str,
    catalog_generation: u64,
    task_key: &str,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        let root_key = normalize_root_path(root_path);
        let completed = transaction
            .execute(
                "update workspace_index_deep_refresh_catalogs
                 set state = 'complete'
                 where root_path = ?1 and catalog_generation = ?2 and state = 'active'",
                params![root_key, catalog_generation as i64],
            )
            .map_err(|error| error.to_string())?;
        if completed != 1 {
            return Err(format!(
                "Deep refresh catalog generation {catalog_generation} was superseded before completion"
            ));
        }
        transaction
            .execute(
                "delete from workspace_index_deep_refresh_checkpoints
                 where root_path = ?1 and task_key = ?2",
                params![root_key, task_key],
            )
            .map_err(|error| error.to_string())?;
        persist_metadata_row(transaction, &root_key, state)?;
        Ok(())
    })
}

fn normalized_unique_paths(paths: &[String]) -> Vec<String> {
    let mut paths = paths.to_vec();
    paths.sort();
    paths.dedup();
    paths
}

fn normalize_root_path(path: &str) -> String {
    path.replace('/', "\\")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        complete_deep_refresh_catalog, create_deep_refresh_catalog, is_deep_refresh_catalog_active,
        load_deep_refresh_catalog_batch, load_deep_refresh_catalog_lifecycle,
        load_deep_refresh_catalog_page, prune_terminal_deep_refresh_catalogs,
        supersede_deep_refresh_catalog,
    };

    #[test]
    fn pages_a_stable_generation_by_file_identity() {
        let root = temp_root("deep-catalog-page");
        let root_path = root.to_string_lossy().to_string();
        let paths = vec![
            "b.ets".to_string(),
            "a.ets".to_string(),
            "b.ets".to_string(),
        ];
        assert_eq!(
            create_deep_refresh_catalog(&root_path, 41, &paths).unwrap(),
            2
        );

        let first = load_deep_refresh_catalog_page(&root_path, 41, None, 1)
            .unwrap()
            .unwrap();
        assert_eq!(first.files.len(), 1);
        let second =
            load_deep_refresh_catalog_page(&root_path, 41, Some(first.files[0].file_id), 8)
                .unwrap()
                .unwrap();
        assert_eq!(second.files.len(), 1);
        assert_ne!(first.files[0].file_id, second.files[0].file_id);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn superseded_catalog_cannot_be_loaded() {
        let root = temp_root("deep-catalog-supersede");
        let root_path = root.to_string_lossy().to_string();
        create_deep_refresh_catalog(&root_path, 7, &["a.ets".to_string()]).unwrap();
        supersede_deep_refresh_catalog(&root_path, 7).unwrap();

        let state = crate::models::workspace::WorkspaceIndexState {
            status: crate::models::workspace::WorkspaceIndexStatus::Ready,
            root_path: Some(root_path.clone()),
            file_paths: vec!["a.ets".to_string()],
            symbols: Vec::new(),
            indexed_at: Some(7),
            partial_reason: None,
        };

        assert!(load_deep_refresh_catalog_page(&root_path, 7, None, 1)
            .unwrap()
            .is_none());
        assert!(complete_deep_refresh_catalog(&root_path, 7, "superseded", &state).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn page_upper_bound_replays_only_the_completed_content_batch() {
        let root = temp_root("deep-catalog-bound");
        let root_path = root.to_string_lossy().to_string();
        create_deep_refresh_catalog(
            &root_path,
            9,
            &[
                "a.ets".to_string(),
                "b.ets".to_string(),
                "c.ets".to_string(),
            ],
        )
        .unwrap();
        let content = load_deep_refresh_catalog_page(&root_path, 9, None, 2)
            .unwrap()
            .unwrap();
        let batch_end = content.files.last().unwrap().file_id;
        let stub = load_deep_refresh_catalog_batch(&root_path, 9, None, Some(batch_end), 8)
            .unwrap()
            .unwrap();

        assert_eq!(stub.files, content.files);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_catalog_supersedes_previous_generation_and_checkpoint() {
        let root = temp_root("deep-catalog-generation");
        let root_path = root.to_string_lossy().to_string();
        create_deep_refresh_catalog(&root_path, 1, &["old.ets".to_string()]).unwrap();
        super::super::workspace_index_deep_refresh_cursor_service::save_deep_refresh_cursor(
            &root_path,
            &super::super::workspace_index_deep_refresh_cursor_service::WorkspaceIndexDeepRefreshCursor {
                task_key: "full-refresh-deep:old".to_string(),
                catalog_generation: 1,
                phase: super::super::workspace_index_deep_refresh_cursor_service::WorkspaceIndexDeepRefreshPhase::Content,
                last_file_id: 0,
                batch_last_file_id: None,
            },
        )
        .unwrap();
        create_deep_refresh_catalog(&root_path, 2, &["new.ets".to_string()]).unwrap();

        assert!(!is_deep_refresh_catalog_active(&root_path, 1).unwrap());
        assert!(is_deep_refresh_catalog_active(&root_path, 2).unwrap());
        let lifecycle = load_deep_refresh_catalog_lifecycle(&root_path).unwrap();
        assert_eq!(lifecycle.active_generation, Some(2));
        assert_eq!(lifecycle.terminal_catalog_count, 1);
        assert_eq!(lifecycle.checkpoint_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prunes_terminal_catalog_rows_without_touching_active_generation() {
        let root = temp_root("deep-catalog-prune");
        let root_path = root.to_string_lossy().to_string();
        create_deep_refresh_catalog(&root_path, 1, &["old.ets".to_string()]).unwrap();
        supersede_deep_refresh_catalog(&root_path, 1).unwrap();
        create_deep_refresh_catalog(&root_path, 2, &["current.ets".to_string()]).unwrap();

        assert_eq!(
            prune_terminal_deep_refresh_catalogs(&root_path, i64::MAX).unwrap(),
            1
        );
        let lifecycle = load_deep_refresh_catalog_lifecycle(&root_path).unwrap();
        assert_eq!(lifecycle.active_generation, Some(2));
        assert_eq!(lifecycle.terminal_catalog_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arkline-{name}-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
