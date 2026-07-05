use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::WorkspaceIndexFileReadiness;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub fn get_workspace_index_file_readiness(
    root_path: &str,
    file_path: &str,
) -> Result<WorkspaceIndexFileReadiness, String> {
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(file_path);
    let file_name = file_name(file_path);

    let file_ready = has_row(
        &connection,
        "workspace_files",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let content_ready = has_row(
        &connection,
        "workspace_content_lines",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let declaration_ready = has_row(
        &connection,
        "workspace_symbol_entities",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let reference_ready = has_row(
        &connection,
        "workspace_symbol_references",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let stub_ready = has_row(
        &connection,
        "workspace_stub_files",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let symbol_ready = declaration_ready || reference_ready || stub_ready;
    let parser_error = parser_error_for_path(&connection, &root_key, &path_key)?;
    let indexed_generation = indexed_generation_for_path(&connection, &root_key, &path_key)?;
    let parser_status = if parser_error.is_some() {
        "failed"
    } else if indexed_generation.is_some() {
        "ready"
    } else {
        "unknown"
    };
    let definition_available = file_ready && symbol_ready && parser_error.is_none();
    let completion_available = file_ready && parser_error.is_none();
    let usages_available = file_ready && symbol_ready && parser_error.is_none();
    let search_available = content_ready || Path::new(file_path).is_file();

    Ok(WorkspaceIndexFileReadiness {
        root_path: root_key,
        path: path_key,
        file_name: file_name.to_string(),
        file_index: layer_status(file_ready),
        content_index: layer_status(content_ready),
        symbol_index: layer_status(symbol_ready),
        parser_status: parser_status.to_string(),
        parser_error,
        indexed_generation,
        definition_available,
        completion_available,
        usages_available,
        search_available,
        reason: readiness_reason(
            &file_name,
            file_ready,
            content_ready,
            symbol_ready,
            parser_status,
        ),
    })
}

fn has_row(
    connection: &Connection,
    table_name: &str,
    predicate: &str,
    root_key: &str,
    path_key: &str,
) -> Result<bool, String> {
    let sql = format!("select exists(select 1 from {table_name} where {predicate})");
    connection
        .query_row(&sql, params![root_key, path_key], |row| {
            row.get::<_, bool>(0)
        })
        .map_err(|error| error.to_string())
}

fn parser_error_for_path(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select message from workspace_stub_parse_errors
             where root_path = ?1 and path = ?2
             order by line, column
             limit 1",
            params![root_key, path_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn indexed_generation_for_path(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<Option<u64>, String> {
    connection
        .query_row(
            "select indexed_generation from workspace_file_fingerprints
             where root_path = ?1 and path = ?2
             limit 1",
            params![root_key, path_key],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map(|generation| generation.map(|value| value as u64))
        .map_err(|error| error.to_string())
}

fn layer_status(ready: bool) -> String {
    if ready { "ready" } else { "missing" }.to_string()
}

fn readiness_reason(
    file_name: &str,
    file_ready: bool,
    content_ready: bool,
    symbol_ready: bool,
    parser_status: &str,
) -> String {
    if parser_status == "failed" {
        return format!(
            "{file_name} is indexed but its parser failed; navigation may be incomplete."
        );
    }
    if !file_ready {
        return format!(
            "{file_name} is not indexed because it has not completed foreground indexing."
        );
    }
    if !symbol_ready {
        return format!("{file_name} is in the file index but symbol data is not ready yet.");
    }
    if !content_ready {
        return format!("{file_name} is in the file index but text search rows are not ready yet.");
    }
    format!("{file_name} is indexed and semantic navigation can use the workspace index.")
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace file readiness index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
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

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}
