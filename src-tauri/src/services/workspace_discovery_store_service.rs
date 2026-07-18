use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::services::workspace_discovery_service::{
    WorkspaceDiscoveredFile, WorkspaceDiscoveryCursor,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceDiscoveryState {
    pub root_path: String,
    pub generation: i64,
    pub status: String,
    pub discovered_count: usize,
    pub excluded_count: usize,
    pub cursor: Option<WorkspaceDiscoveryCursor>,
    pub error: Option<String>,
}

pub fn replace_discovered_file_chunk(
    root_path: &str,
    generation: i64,
    files: &[WorkspaceDiscoveredFile],
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    replace_discovered_file_chunk_in_connection(&connection, root_path, generation, files)
}

pub(crate) fn replace_discovered_file_chunk_in_connection(
    connection: &Connection,
    root_path: &str,
    generation: i64,
    files: &[WorkspaceDiscoveredFile],
) -> Result<(), String> {
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "insert into workspace_discovered_files (
                root_path, path, generation, modified_ms, size_bytes, excluded
             ) values (?1, ?2, ?3, ?4, ?5, 0)
             on conflict(root_path, path) do update set
                generation = excluded.generation,
                modified_ms = excluded.modified_ms,
                size_bytes = excluded.size_bytes,
                excluded = excluded.excluded",
        )
        .map_err(|error| error.to_string())?;

    for file in files {
        statement
            .execute(params![
                root_key,
                normalize_index_path(&file.path),
                generation,
                file.modified_ms.map(|value| value as i64),
                file.size_bytes as i64,
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn update_discovery_state(state: &WorkspaceDiscoveryState) -> Result<(), String> {
    if !Path::new(&state.root_path).is_dir() {
        return Ok(());
    }
    let connection = open_index_store(&state.root_path)?;
    ensure_workspace_index_schema(&connection)?;
    update_discovery_state_in_connection(&connection, state)
}

pub(crate) fn update_discovery_state_in_connection(
    connection: &Connection,
    state: &WorkspaceDiscoveryState,
) -> Result<(), String> {
    let cursor_json = state
        .cursor
        .as_ref()
        .map(|cursor| serde_json::to_string(&cursor.pending_directories))
        .transpose()
        .map_err(|error| error.to_string())?;

    connection
        .execute(
            "insert into workspace_discovery_state (
                root_path, generation, status, discovered_count, excluded_count,
                cursor_json, updated_at_ms, error
             ) values (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now') * 1000, ?7)
             on conflict(root_path) do update set
                generation = excluded.generation,
                status = excluded.status,
                discovered_count = excluded.discovered_count,
                excluded_count = excluded.excluded_count,
                cursor_json = excluded.cursor_json,
                updated_at_ms = excluded.updated_at_ms,
                error = excluded.error",
            params![
                normalize_index_path(&state.root_path),
                state.generation,
                state.status,
                state.discovered_count as i64,
                state.excluded_count as i64,
                cursor_json,
                state.error,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_discovered_files(root_path: &str, limit: usize) -> Result<Vec<String>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let mut statement = connection
        .prepare(
            "select path
             from workspace_discovered_files
             where root_path = ?1 and excluded = 0
             order by path
             limit ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![normalize_index_path(root_path), limit as i64],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn load_ready_discovered_files(
    root_path: &str,
    limit: usize,
) -> Result<Option<Vec<String>>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(None);
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let status = connection
        .query_row(
            "select status
             from workspace_discovery_state
             where root_path = ?1",
            params![normalize_index_path(root_path)],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if status.as_deref() != Some("ready") {
        return Ok(None);
    }
    load_discovered_files(root_path, limit).map(Some)
}

pub fn load_discovery_cursor(root_path: &str) -> Result<Option<WorkspaceDiscoveryCursor>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(None);
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let cursor_json = connection
        .query_row(
            "select cursor_json
             from workspace_discovery_state
             where root_path = ?1",
            params![normalize_index_path(root_path)],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let Some(cursor_json) = cursor_json else {
        return Ok(None);
    };
    let pending_directories =
        serde_json::from_str::<Vec<String>>(&cursor_json).map_err(|error| error.to_string())?;
    if pending_directories.is_empty() {
        return Ok(None);
    }
    Ok(Some(WorkspaceDiscoveryCursor {
        pending_directories,
    }))
}

pub fn load_discovery_state(root_path: &str) -> Result<Option<WorkspaceDiscoveryState>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(None);
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    load_discovery_state_in_connection(&connection, root_path)
}

pub(crate) fn load_discovery_state_in_connection(
    connection: &Connection,
    root_path: &str,
) -> Result<Option<WorkspaceDiscoveryState>, String> {
    let root_key = normalize_index_path(root_path);
    connection
        .query_row(
            "select generation, status, discovered_count, excluded_count, cursor_json, error
             from workspace_discovery_state where root_path = ?1",
            params![root_key],
            |row| {
                let cursor_json = row.get::<_, Option<String>>(4)?;
                let cursor = cursor_json
                    .map(|value| serde_json::from_str::<Vec<String>>(&value))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?
                    .filter(|paths| !paths.is_empty())
                    .map(|pending_directories| WorkspaceDiscoveryCursor {
                        pending_directories,
                    });
                Ok(WorkspaceDiscoveryState {
                    root_path: root_path.to_string(),
                    generation: row.get(0)?,
                    status: row.get(1)?,
                    discovered_count: row.get::<_, i64>(2)? as usize,
                    excluded_count: row.get::<_, i64>(3)? as usize,
                    cursor,
                    error: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn prune_discovered_files_except_generation(
    root_path: &str,
    generation: i64,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    prune_discovered_files_except_generation_in_connection(&connection, root_path, generation)
}

pub(crate) fn prune_discovered_files_except_generation_in_connection(
    connection: &Connection,
    root_path: &str,
    generation: i64,
) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_discovered_files
             where root_path = ?1 and generation <> ?2",
            params![normalize_index_path(root_path), generation],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn count_discovered_files(root_path: &str) -> Result<usize, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(0);
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    count_discovered_files_in_connection(&connection, root_path)
}

pub(crate) fn count_discovered_files_in_connection(
    connection: &Connection,
    root_path: &str,
) -> Result<usize, String> {
    connection
        .query_row(
            "select count(*)
             from workspace_discovered_files
             where root_path = ?1 and excluded = 0",
            params![normalize_index_path(root_path)],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count as usize)
        .map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace discovery store path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
