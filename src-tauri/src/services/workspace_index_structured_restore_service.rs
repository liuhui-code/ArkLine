use rusqlite::{params, Connection};

use crate::models::workspace::{
    WorkspaceIndexState, WorkspaceIndexStatus, WorkspaceIndexedSymbol,
};
use crate::services::workspace_index_metadata_restore_service::restore_metadata;

pub(crate) fn restore_structured_sqlite_catalog_cache(
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
