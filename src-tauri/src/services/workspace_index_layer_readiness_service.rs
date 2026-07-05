use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace_index_layer::{
    WorkspaceIndexLayerReadiness, WorkspaceIndexLayerReadinessReport, WorkspaceIndexLayerStatus,
};
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub fn get_workspace_index_layer_readiness(
    root_path: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadinessReport, String> {
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let current_file_key = current_file_path.map(normalize_index_path);
    let file_readiness = current_file_path
        .map(|path| get_workspace_index_file_readiness(root_path, path))
        .transpose()?;

    Ok(WorkspaceIndexLayerReadinessReport {
        root_path: root_key.clone(),
        current_file_path: current_file_key,
        layers: vec![
            discovery_layer(&connection, &root_key, current_file_path)?,
            counted_layer(
                &connection,
                &root_key,
                "fileCatalog",
                "workspace_files",
                current_file_path,
            )?,
            counted_layer(
                &connection,
                &root_key,
                "fingerprint",
                "workspace_file_fingerprints",
                current_file_path,
            )?,
            content_layer(&connection, &root_key, file_readiness.as_ref())?,
            stub_layer(&connection, &root_key, file_readiness.as_ref())?,
            symbol_layer(&connection, &root_key, file_readiness.as_ref())?,
            reference_layer(&connection, &root_key, current_file_path)?,
            counted_layer(
                &connection,
                &root_key,
                "dependencyGraph",
                "workspace_dependency_edges",
                None,
            )?,
            sdk_layer(&connection, &root_key)?,
        ],
    })
}

fn discovery_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let row = connection
        .query_row(
            "select status, discovered_count, excluded_count, cursor_json
             from workspace_discovery_state where root_path = ?1 limit 1",
            params![root_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((status, discovered, excluded, cursor_json)) = row else {
        return Ok(layer(
            "discovery",
            WorkspaceIndexLayerStatus::Missing,
            0,
            0,
            0,
            Some("rebuildIndex"),
        ));
    };
    let workspace_status = match status.as_str() {
        "ready" => WorkspaceIndexLayerStatus::Ready,
        "failed" => WorkspaceIndexLayerStatus::Failed,
        _ => WorkspaceIndexLayerStatus::Partial,
    };
    let has_more = cursor_json
        .as_ref()
        .map(|value| !value.trim().is_empty() && value != "[]")
        .unwrap_or(false);
    Ok(WorkspaceIndexLayerReadiness {
        layer: "discovery".to_string(),
        workspace_status,
        current_file_status: discovery_current_file_status(
            connection,
            root_key,
            current_file_path,
        )?,
        indexed_count: discovered,
        failed_count: excluded,
        stale_count: 0,
        reason: has_more.then(|| "Discovery has a pending cursor".to_string()),
        recommended_action: (has_more || status == "partial").then(|| "wait".to_string()),
    })
}

fn counted_layer(
    connection: &Connection,
    root_key: &str,
    name: &str,
    table_name: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = count_rows(connection, table_name, root_key)?;
    let current = current_file_path
        .map(|path| {
            row_exists(
                connection,
                table_name,
                root_key,
                &normalize_index_path(path),
            )
        })
        .transpose()?
        .map(status_from_bool);
    Ok(layer_with_current(
        name,
        status_from_count(count),
        current,
        count,
        0,
        0,
        None,
    ))
}

fn content_layer(
    connection: &Connection,
    root_key: &str,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = count_distinct_paths(connection, "workspace_content_lines", root_key)?;
    Ok(layer_with_current(
        "content",
        status_from_count(count),
        file_readiness.map(|readiness| status_from_text(&readiness.content_index)),
        count,
        0,
        0,
        None,
    ))
}

fn stub_layer(
    connection: &Connection,
    root_key: &str,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = count_rows(connection, "workspace_stub_files", root_key)?;
    let failures = count_rows(connection, "workspace_stub_parse_errors", root_key)?;
    Ok(layer_with_current(
        "stub",
        status_with_failures(count, failures),
        file_readiness.map(|readiness| status_from_text(&readiness.parser_status)),
        count,
        failures,
        0,
        None,
    ))
}

fn symbol_layer(
    connection: &Connection,
    root_key: &str,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = count_rows(connection, "workspace_symbol_entities", root_key)?;
    Ok(layer_with_current(
        "symbols",
        status_from_count(count),
        file_readiness.map(|readiness| status_from_text(&readiness.symbol_index)),
        count,
        0,
        0,
        None,
    ))
}

fn reference_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    counted_layer(
        connection,
        root_key,
        "references",
        "workspace_symbol_references",
        current_file_path,
    )
}

fn sdk_layer(
    connection: &Connection,
    root_key: &str,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = count_rows(connection, "workspace_sdk_symbols", root_key)?;
    Ok(layer(
        "sdk",
        status_from_count(count),
        count,
        0,
        0,
        Some("configureSdk"),
    ))
}

fn discovery_current_file_status(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<Option<WorkspaceIndexLayerStatus>, String> {
    current_file_path
        .map(|path| {
            row_exists(
                connection,
                "workspace_discovered_files",
                root_key,
                &normalize_index_path(path),
            )
        })
        .transpose()
        .map(|value| value.map(status_from_bool))
}

fn layer(
    name: &str,
    status: WorkspaceIndexLayerStatus,
    indexed: i64,
    failed: i64,
    stale: i64,
    action: Option<&str>,
) -> WorkspaceIndexLayerReadiness {
    layer_with_current(name, status, None, indexed, failed, stale, action)
}

fn layer_with_current(
    name: &str,
    status: WorkspaceIndexLayerStatus,
    current: Option<WorkspaceIndexLayerStatus>,
    indexed: i64,
    failed: i64,
    stale: i64,
    action: Option<&str>,
) -> WorkspaceIndexLayerReadiness {
    WorkspaceIndexLayerReadiness {
        layer: name.to_string(),
        workspace_status: status,
        current_file_status: current,
        indexed_count: indexed,
        failed_count: failed,
        stale_count: stale,
        reason: None,
        recommended_action: action.map(|value| value.to_string()),
    }
}

fn status_from_count(count: i64) -> WorkspaceIndexLayerStatus {
    status_from_bool(count > 0)
}

fn status_with_failures(count: i64, failures: i64) -> WorkspaceIndexLayerStatus {
    if failures > 0 {
        WorkspaceIndexLayerStatus::Failed
    } else {
        status_from_count(count)
    }
}

fn status_from_bool(value: bool) -> WorkspaceIndexLayerStatus {
    if value {
        WorkspaceIndexLayerStatus::Ready
    } else {
        WorkspaceIndexLayerStatus::Missing
    }
}

fn status_from_text(value: &str) -> WorkspaceIndexLayerStatus {
    match value {
        "ready" => WorkspaceIndexLayerStatus::Ready,
        "partial" => WorkspaceIndexLayerStatus::Partial,
        "stale" => WorkspaceIndexLayerStatus::Stale,
        "failed" => WorkspaceIndexLayerStatus::Failed,
        _ => WorkspaceIndexLayerStatus::Missing,
    }
}

fn row_exists(
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

fn count_rows(connection: &Connection, table_name: &str, root_key: &str) -> Result<i64, String> {
    let sql = format!("select count(*) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn count_distinct_paths(
    connection: &Connection,
    table_name: &str,
    root_key: &str,
) -> Result<i64, String> {
    let sql = format!("select count(distinct path) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
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

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
