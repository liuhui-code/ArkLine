use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexedSymbol};
use crate::services::workspace_incremental_path_plan_service::{
    plan_incremental_index_paths, WorkspaceIncrementalPathPlan,
};
use crate::services::workspace_index_entity_persistence_service::{
    persist_metadata_row, replace_changed_files, replace_changed_symbols_for_paths,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::replace_changed_stub_rows;

pub fn persist_incremental_sqlite_index_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let mut connection = open_incremental_store(root_path)?;
    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    persist_file_symbol_rows(&transaction, &root_key, state, changed_symbols, &path_plan)?;
    replace_changed_stub_rows(
        &transaction,
        &root_key,
        &state.file_paths,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
        indexed_generation(state),
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn persist_incremental_sqlite_file_symbol_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let mut connection = open_incremental_store(root_path)?;
    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    persist_file_symbol_rows(&transaction, &root_key, state, changed_symbols, &path_plan)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn persist_incremental_sqlite_deep_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let mut connection = open_incremental_store(root_path)?;
    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    replace_changed_stub_rows(
        &transaction,
        &root_key,
        &state.file_paths,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
        indexed_generation(state),
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

fn persist_file_symbol_rows(
    connection: &Connection,
    root_key: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    path_plan: &WorkspaceIncrementalPathPlan,
) -> Result<(), String> {
    persist_metadata_row(connection, root_key, state)?;
    replace_changed_files(
        connection,
        root_key,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
    )?;
    replace_changed_symbols_for_paths(
        connection,
        root_key,
        changed_symbols,
        &path_plan.affected_paths,
    )
}

fn open_incremental_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite catalog cache path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let connection = Connection::open(&cache_path).map_err(|error| error.to_string())?;
    ensure_workspace_index_schema(&connection)?;
    Ok(connection)
}

fn indexed_generation(state: &WorkspaceIndexState) -> u64 {
    state.indexed_at.unwrap_or_default() as u64
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
