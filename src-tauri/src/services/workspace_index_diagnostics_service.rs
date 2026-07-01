use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexDiagnostics;
use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};

pub fn inspect_workspace_index(root_path: &str) -> Result<WorkspaceIndexDiagnostics, String> {
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let active_sdk = load_active_sdk_metadata(&connection, &root_key)?;

    Ok(WorkspaceIndexDiagnostics {
        root_path: root_key.clone(),
        status: load_status(&connection, &root_key)?,
        schema_versions: load_workspace_index_schema_versions(&connection)?,
        file_count: count_rows(&connection, "workspace_files", &root_key)?,
        symbol_count: count_rows(&connection, "workspace_symbols", &root_key)?,
        content_line_count: count_rows(&connection, "workspace_content_lines", &root_key)?,
        fingerprint_count: count_rows(&connection, "workspace_file_fingerprints", &root_key)?,
        sdk_symbol_count: count_sdk_symbols(&connection, &root_key, active_sdk.as_ref())?,
        active_sdk_path: active_sdk
            .as_ref()
            .map(|metadata| denormalize_index_path(&metadata.sdk_path)),
        active_sdk_version: active_sdk.map(|metadata| metadata.sdk_version),
        last_error: None,
    })
}

#[derive(Debug, Clone)]
struct ActiveSdkMetadata {
    sdk_path: String,
    sdk_version: String,
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn load_status(connection: &Connection, root_key: &str) -> Result<String, String> {
    let mut statement = connection
        .prepare(
            "select status
             from workspace_index_metadata
             where root_path = ?1
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.next()
        .transpose()
        .map_err(|error| error.to_string())
        .map(|status| status.unwrap_or_else(|| "empty".to_string()))
}

fn count_rows(connection: &Connection, table_name: &str, root_key: &str) -> Result<i64, String> {
    let sql = format!("select count(*) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn count_sdk_symbols(
    connection: &Connection,
    root_key: &str,
    active_sdk: Option<&ActiveSdkMetadata>,
) -> Result<i64, String> {
    let Some(active_sdk) = active_sdk else {
        return count_rows(connection, "workspace_sdk_symbols", root_key);
    };
    connection
        .query_row(
            "select count(*)
             from workspace_sdk_symbols
             where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
            params![root_key, active_sdk.sdk_path, active_sdk.sdk_version],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn load_active_sdk_metadata(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<ActiveSdkMetadata>, String> {
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
            Ok(ActiveSdkMetadata {
                sdk_path: row.get(0)?,
                sdk_version: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
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

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}
