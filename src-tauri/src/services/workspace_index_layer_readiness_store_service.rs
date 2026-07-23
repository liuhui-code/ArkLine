use rusqlite::{params, Connection};

use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub(crate) fn with_layer_readiness_store<T>(
    root_path: &str,
    operation: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    if let Some(connection) = open_existing_workspace_index_reader(root_path)? {
        return operation(&connection);
    }
    let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
    ensure_workspace_index_schema(&connection)?;
    operation(&connection)
}

pub(crate) fn row_exists(
    connection: &Connection,
    table_name: &str,
    root_key: &str,
    path_key: &str,
) -> Result<bool, String> {
    let sql =
        format!("select exists(select 1 from {table_name} where root_path = ?1 and path = ?2)");
    connection
        .query_row(&sql, params![root_key, path_key], |row| {
            row.get::<_, bool>(0)
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn count_rows(
    connection: &Connection,
    table_name: &str,
    root_key: &str,
) -> Result<i64, String> {
    let sql = format!("select count(*) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) fn count_distinct_paths(
    connection: &Connection,
    table_name: &str,
    root_key: &str,
) -> Result<i64, String> {
    let sql = format!("select count(distinct path) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

pub(crate) fn normalize_layer_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
