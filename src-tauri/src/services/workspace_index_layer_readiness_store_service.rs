use std::fs;

use rusqlite::{params, Connection};

use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;

pub(crate) fn open_layer_readiness_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
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
