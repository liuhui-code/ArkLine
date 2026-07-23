use rusqlite::params;

use crate::models::workspace::{
    WorkspaceIndexParserFailure, WorkspaceIndexSdkRepairTarget, WorkspaceIndexUnresolvedImport,
};
use crate::services::workspace_index_connection_service::{
    require_existing_workspace_index_reader, WorkspaceIndexReader,
};

pub fn inspect_parser_failures(
    root_path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceIndexParserFailure>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select path, message, line, column
             from workspace_stub_parse_errors
             where root_path = ?1
             order by path, line, column
             limit ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, limit as i64], |row| {
            Ok(WorkspaceIndexParserFailure {
                path: denormalize_index_path(&row.get::<_, String>(0)?),
                message: row.get(1)?,
                line: row.get::<_, i64>(2)? as usize,
                column: row.get::<_, i64>(3)? as usize,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn inspect_unresolved_imports(
    root_path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceIndexUnresolvedImport>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select from_path, source_module, line, column
             from workspace_unresolved_imports
             where root_path = ?1
             order by from_path, line, column
             limit ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, limit as i64], |row| {
            Ok(WorkspaceIndexUnresolvedImport {
                from_path: denormalize_index_path(&row.get::<_, String>(0)?),
                source_module: row.get(1)?,
                line: row.get::<_, i64>(2)? as usize,
                column: row.get::<_, i64>(3)? as usize,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn load_active_sdk_repair_target(
    root_path: &str,
) -> Result<Option<WorkspaceIndexSdkRepairTarget>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select sdk_path, sdk_version
             from workspace_sdk_index_metadata
             where root_path = ?1
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key], |row| {
            Ok(WorkspaceIndexSdkRepairTarget {
                sdk_path: denormalize_index_path(&row.get::<_, String>(0)?),
                sdk_version: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<WorkspaceIndexReader<'static>, String> {
    require_existing_workspace_index_reader(root_path)
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}
