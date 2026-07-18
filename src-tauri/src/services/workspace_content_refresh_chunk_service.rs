use rusqlite::OptionalExtension;

use crate::services::workspace_content_refresh_service::{
    normalize_index_path, prepare_workspace_content_refresh, publish_workspace_content_refresh,
};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_layer_generation_service::{
    reject_stale_layer_generation, CONTENT_LAYER,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_refresh_chunk_service::workspace_file_catalog_contains_paths;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceContentRefreshChunkSummary {
    pub(crate) indexed_file_count: usize,
    pub(crate) indexed_line_count: usize,
    pub(crate) unreadable_file_count: usize,
    pub(crate) resource_limited_file_count: usize,
    pub(crate) processed_source_bytes: usize,
}

pub(crate) fn run_workspace_content_refresh_chunk(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceContentRefreshChunkSummary, String> {
    if !workspace_file_catalog_contains_paths(root_path, changed_paths)? {
        return Err("Content refresh path is absent from workspace file index".to_string());
    }
    let root_key = normalize_index_path(root_path);
    reject_stale_content_generation(root_path, &root_key, indexed_generation)?;
    let prepared = prepare_workspace_content_refresh(
        root_path,
        changed_paths,
        removed_paths,
        indexed_generation,
    );
    let summary = WorkspaceContentRefreshChunkSummary {
        indexed_file_count: prepared.files.len(),
        indexed_line_count: prepared.files.iter().map(|file| file.line_count).sum(),
        unreadable_file_count: prepared
            .failures
            .iter()
            .filter(|failure| !failure.resource_limited)
            .count(),
        resource_limited_file_count: prepared
            .failures
            .iter()
            .filter(|failure| failure.resource_limited)
            .count(),
        processed_source_bytes: prepared.source_bytes,
    };

    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        reject_stale_content_generation_in_connection(transaction, &root_key, indexed_generation)?;
        publish_workspace_content_refresh(transaction, &root_key, &prepared)?;
        Ok(())
    })?;
    Ok(summary)
}

fn reject_stale_content_generation(
    root_path: &str,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(());
    };
    if !content_file_table_exists(&connection)? {
        return Ok(());
    }
    reject_stale_content_generation_in_connection(&connection, root_key, indexed_generation)
}

fn content_file_table_exists(connection: &rusqlite::Connection) -> Result<bool, String> {
    connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = 'workspace_content_files'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| error.to_string())
}

fn reject_stale_content_generation_in_connection(
    connection: &rusqlite::Connection,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    reject_stale_layer_generation(connection, root_key, CONTENT_LAYER, indexed_generation)
}
