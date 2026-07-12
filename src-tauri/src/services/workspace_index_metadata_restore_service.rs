use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::WorkspaceIndexStatus;

#[derive(Debug)]
pub(crate) struct RestoredMetadata {
    pub(crate) status: WorkspaceIndexStatus,
    pub(crate) indexed_at: Option<u128>,
    pub(crate) partial_reason: Option<String>,
}

pub(crate) fn restore_metadata(
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
