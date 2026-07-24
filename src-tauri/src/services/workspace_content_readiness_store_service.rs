use rusqlite::{params, Connection, OptionalExtension};

use crate::services::workspace_content_stats_schema_service::load_materialized_content_stats;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceContentFileState {
    pub(crate) status: String,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkspaceContentLayerSummary {
    pub(crate) ready_count: i64,
    pub(crate) failed_count: i64,
}

pub(crate) fn load_content_file_state(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<Option<WorkspaceContentFileState>, String> {
    connection
        .query_row(
            "select status, error from workspace_content_files
             where root_path = ?1 and path = ?2 limit 1",
            params![root_key, path_key],
            |row| {
                Ok(WorkspaceContentFileState {
                    status: row.get(0)?,
                    error: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub(crate) fn load_content_layer_summary(
    connection: &Connection,
    root_key: &str,
) -> Result<WorkspaceContentLayerSummary, String> {
    let (ready_count, failed_count) =
        load_materialized_content_stats(connection, root_key)?.unwrap_or_default();
    Ok(WorkspaceContentLayerSummary {
        ready_count,
        failed_count,
    })
}
