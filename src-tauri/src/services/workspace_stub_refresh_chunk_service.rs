use std::collections::HashSet;

use rusqlite::params;

use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_layer_generation_service::{
    reject_stale_layer_generation, STUB_LAYER,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::{
    normalize_index_path, replace_changed_stub_rows_with_parsed,
};
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceStubRefreshChunkSummary {
    pub(crate) parsed_file_count: usize,
    pub(crate) parse_error_count: usize,
}

pub(crate) fn run_workspace_stub_refresh_chunk(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceStubRefreshChunkSummary, String> {
    let root_key = normalize_index_path(root_path);
    let file_paths = load_workspace_file_paths(root_path, &root_key)?;
    reject_paths_outside_catalog(&file_paths, changed_paths)?;
    reject_stale_generation(root_path, &root_key, indexed_generation)?;
    let prepared = prepare_changed_stub_rows(
        &root_key,
        changed_paths,
        removed_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::Background,
    );
    let summary = WorkspaceStubRefreshChunkSummary {
        parsed_file_count: prepared.stubs.len(),
        parse_error_count: prepared
            .stubs
            .iter()
            .map(|stub| stub.parse_errors.len())
            .sum(),
    };

    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        reject_stale_generation_in_connection(transaction, &root_key, indexed_generation)?;
        replace_changed_stub_rows_with_parsed(
            transaction,
            &root_key,
            &file_paths,
            &prepared,
            indexed_generation,
        )?;
        Ok(())
    })?;
    Ok(summary)
}

pub(crate) fn workspace_file_catalog_contains_paths(
    root_path: &str,
    paths: &[String],
) -> Result<bool, String> {
    let root_key = normalize_index_path(root_path);
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(false);
    };
    let file_paths = load_workspace_file_paths_from_connection(&connection, &root_key)?;
    Ok(first_path_outside_catalog(&file_paths, paths).is_none())
}

fn reject_paths_outside_catalog(
    file_paths: &[String],
    changed_paths: &[String],
) -> Result<(), String> {
    if let Some(path) = first_path_outside_catalog(file_paths, changed_paths) {
        return Err(format!(
            "Stub refresh path is absent from workspace file index: {path}"
        ));
    }
    Ok(())
}

fn first_path_outside_catalog(file_paths: &[String], paths: &[String]) -> Option<String> {
    let catalog = file_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    paths
        .iter()
        .map(|path| normalize_index_path(path))
        .find(|path| !catalog.contains(path))
}

fn load_workspace_file_paths(root_path: &str, root_key: &str) -> Result<Vec<String>, String> {
    let connection = open_existing_workspace_index_reader(root_path)?
        .ok_or_else(|| "Workspace file index is unavailable for stub refresh".to_string())?;
    load_workspace_file_paths_from_connection(&connection, root_key)
}

fn load_workspace_file_paths_from_connection(
    connection: &rusqlite::Connection,
    root_key: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select path from workspace_files
             where root_path = ?1 order by path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn reject_stale_generation(
    root_path: &str,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(());
    };
    reject_stale_generation_in_connection(&connection, root_key, indexed_generation)
}

fn reject_stale_generation_in_connection(
    connection: &rusqlite::Connection,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    reject_stale_layer_generation(connection, root_key, STUB_LAYER, indexed_generation)
}
