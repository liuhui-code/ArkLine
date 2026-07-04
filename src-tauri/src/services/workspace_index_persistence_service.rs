use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::models::workspace::{
    WorkspaceIndexState, WorkspaceIndexStatus, WorkspaceIndexedSymbol, WorkspaceSnapshot,
};
use crate::services::workspace_index_entity_persistence_service::{
    insert_legacy_symbol, insert_symbol_entity,
};
use crate::services::workspace_index_incremental_persistence_service::{
    persist_incremental_sqlite_deep_state, persist_incremental_sqlite_file_symbol_state,
    persist_incremental_sqlite_index_state,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::replace_all_stub_rows;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCatalogCache {
    schema_version: u32,
    state: WorkspaceIndexState,
}

pub fn persist_catalog_cache(
    snapshot: &WorkspaceSnapshot,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    if !Path::new(&snapshot.root_path).is_dir() {
        return Ok(());
    }

    persist_json_index_state(&snapshot.root_path, state)
        .and_then(|_| persist_sqlite_index_state(&snapshot.root_path, state))
}

pub fn persist_catalog_cache_for_open(
    snapshot: &WorkspaceSnapshot,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    if !Path::new(&snapshot.root_path).is_dir() {
        return Ok(());
    }

    persist_sqlite_index_state_for_open(&snapshot.root_path, state)
}

#[allow(dead_code)]
pub fn persist_index_state(root_path: &str, state: &WorkspaceIndexState) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    persist_json_index_state(root_path, state)?;
    persist_sqlite_index_state(root_path, state)
}

pub fn persist_incremental_index_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    persist_incremental_sqlite_index_state(
        root_path,
        state,
        changed_symbols,
        changed_paths,
        removed_paths,
    )
}

pub fn persist_incremental_file_symbol_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    persist_incremental_sqlite_file_symbol_state(
        root_path,
        state,
        changed_symbols,
        changed_paths,
        removed_paths,
    )
}

pub fn persist_incremental_deep_index_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    persist_incremental_sqlite_deep_state(root_path, state, changed_paths, removed_paths)
}

pub fn restore_catalog_cache_state(root_path: &str) -> Result<WorkspaceIndexState, String> {
    restore_sqlite_catalog_cache(root_path).or_else(|_| restore_json_catalog_cache(root_path))
}

fn persist_json_index_state(root_path: &str, state: &WorkspaceIndexState) -> Result<(), String> {
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

    fs::write(cache_path, content).map_err(|error| error.to_string())
}

fn restore_json_catalog_cache(root_path: &str) -> Result<WorkspaceIndexState, String> {
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

    Ok(cache.state)
}

fn persist_sqlite_index_state(root_path: &str, state: &WorkspaceIndexState) -> Result<(), String> {
    persist_sqlite_index_state_with_mode(root_path, state, true)
}

fn persist_sqlite_index_state_for_open(
    root_path: &str,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    persist_sqlite_index_state_with_mode(root_path, state, false)
}

fn persist_sqlite_index_state_with_mode(
    root_path: &str,
    state: &WorkspaceIndexState,
    include_deep_rows: bool,
) -> Result<(), String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite catalog cache path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let mut connection = Connection::open(&cache_path).map_err(|error| error.to_string())?;
    ensure_schema(&connection)?;

    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let state_json = serde_json::to_string(state).map_err(|error| error.to_string())?;
    let updated_at = now_epoch_ms()? as i64;

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    persist_catalog_row(&transaction, &root_key, &state_json, updated_at)?;
    persist_structured_index_rows(&transaction, &root_key, state, include_deep_rows)?;
    transaction.commit().map_err(|error| error.to_string())?;

    Ok(())
}

fn persist_catalog_row(
    connection: &Connection,
    root_key: &str,
    state_json: &str,
    updated_at: i64,
) -> Result<(), String> {
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
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    if let Ok(state) = restore_structured_sqlite_catalog_cache(&connection, &root_key) {
        return Ok(state);
    }

    let cached_state: Option<(i64, String)> = connection
        .query_row(
            "select schema_version, state_json
             from workspace_catalog
             where root_path = ?1
             order by updated_at desc
             limit 1",
            params![root_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some((schema_version, state_json)) = cached_state {
        if schema_version != 1 {
            return Err(format!(
                "Unsupported workspace SQLite catalog cache schema: {schema_version}"
            ));
        }

        if let Ok(state) = serde_json::from_str(&state_json) {
            return Ok(state);
        }
    }

    Err(format!(
        "Workspace structured SQLite catalog does not exist: {root_key}"
    ))
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    ensure_workspace_index_schema(connection)
}

fn persist_structured_index_rows(
    connection: &Connection,
    root_key: &str,
    state: &WorkspaceIndexState,
    include_deep_rows: bool,
) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_files where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_symbols where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_symbol_entities where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "insert into workspace_index_metadata (
                root_path, status, indexed_at, partial_reason, updated_at
             ) values (?1, ?2, ?3, ?4, ?5)
             on conflict(root_path) do update set
                status = excluded.status,
                indexed_at = excluded.indexed_at,
                partial_reason = excluded.partial_reason,
                updated_at = excluded.updated_at",
            params![
                root_key,
                state.status.to_string(),
                state.indexed_at.map(|value| value as i64),
                state.partial_reason,
                now_epoch_ms()? as i64,
            ],
        )
        .map_err(|error| error.to_string())?;

    for path in &state.file_paths {
        connection
            .execute(
                "insert into workspace_files (root_path, path) values (?1, ?2)",
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }

    for symbol in &state.symbols {
        insert_legacy_symbol(connection, root_key, symbol)?;
        insert_symbol_entity(connection, root_key, symbol)?;
    }
    if include_deep_rows {
        replace_all_stub_rows(
            connection,
            root_key,
            &state.file_paths,
            indexed_generation(state),
        )?;
    }

    Ok(())
}

fn indexed_generation(state: &WorkspaceIndexState) -> u64 {
    state.indexed_at.unwrap_or_default() as u64
}

fn restore_structured_sqlite_catalog_cache(
    connection: &Connection,
    root_key: &str,
) -> Result<WorkspaceIndexState, String> {
    let file_paths = restore_file_paths(connection, root_key)?;
    let symbols = restore_symbols(connection, root_key)?;
    let metadata = restore_metadata(connection, root_key)?;
    if file_paths.is_empty() && symbols.is_empty() {
        return Err(format!(
            "Workspace structured SQLite catalog does not exist: {root_key}"
        ));
    }

    Ok(WorkspaceIndexState {
        status: metadata
            .as_ref()
            .map(|metadata| metadata.status.clone())
            .unwrap_or(WorkspaceIndexStatus::Ready),
        root_path: Some(root_key.to_string()),
        file_paths,
        symbols,
        indexed_at: metadata.as_ref().and_then(|metadata| metadata.indexed_at),
        partial_reason: metadata.and_then(|metadata| metadata.partial_reason),
    })
}

#[derive(Debug)]
struct RestoredMetadata {
    status: WorkspaceIndexStatus,
    indexed_at: Option<u128>,
    partial_reason: Option<String>,
}

fn restore_file_paths(connection: &Connection, root_key: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select path
             from workspace_files
             where root_path = ?1
             order by path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn restore_symbols(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container
             from workspace_symbols
             where root_path = ?1
             order by source, name, path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let line: i64 = row.get(4)?;
            let column: i64 = row.get(5)?;
            Ok(WorkspaceIndexedSymbol {
                source: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
                container: row.get(6)?,
                signature: None,
                visibility: None,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn restore_metadata(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<RestoredMetadata>, String> {
    connection
        .query_row(
            "select status, indexed_at, partial_reason
             from workspace_index_metadata
             where root_path = ?1",
            params![root_key],
            |row| {
                let status: String = row.get(0)?;
                let indexed_at: Option<i64> = row.get(1)?;
                Ok(RestoredMetadata {
                    status: parse_index_status(&status),
                    indexed_at: indexed_at.and_then(|value| u128::try_from(value).ok()),
                    partial_reason: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn parse_index_status(status: &str) -> WorkspaceIndexStatus {
    match status {
        "scanning" => WorkspaceIndexStatus::Scanning,
        "ready" => WorkspaceIndexStatus::Ready,
        "partial" => WorkspaceIndexStatus::Partial,
        "stale" => WorkspaceIndexStatus::Stale,
        "failed" => WorkspaceIndexStatus::Failed,
        _ => WorkspaceIndexStatus::Empty,
    }
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

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
