use rusqlite::{params, Connection, OptionalExtension};

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
    connection
        .query_row(
            "select
                sum(case when status = 'ready' then 1 else 0 end),
                sum(case when status = 'failed' then 1 else 0 end)
             from workspace_content_files where root_path = ?1",
            params![root_key],
            |row| {
                Ok(WorkspaceContentLayerSummary {
                    ready_count: row.get::<_, Option<i64>>(0)?.unwrap_or_default(),
                    failed_count: row.get::<_, Option<i64>>(1)?.unwrap_or_default(),
                })
            },
        )
        .map_err(|error| error.to_string())
}
