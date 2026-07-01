use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::{
    WorkspaceIndexExplainFact, WorkspaceIndexExplainRequest, WorkspaceIndexExplainResult,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_service::should_exclude;

pub fn explain_workspace_index_query(
    request: &WorkspaceIndexExplainRequest,
) -> Result<WorkspaceIndexExplainResult, String> {
    let root = Path::new(&request.root_path);
    if let Some(path) = request.path.as_deref() {
        let candidate_path = Path::new(path);
        if should_exclude(root, candidate_path) {
            return Ok(result(
                "excluded",
                "Path is excluded from workspace indexing",
                vec![fact("path", normalize_index_path(path))],
                Some("openFile"),
            ));
        }
    }

    let connection = open_index_store(&request.root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(&request.root_path);

    if let Some(path) = request.path.as_deref() {
        let path_key = normalize_index_path(path);
        if !has_fingerprint(&connection, &root_key, &path_key)? {
            return Ok(result(
                "notIndexed",
                "File has no index fingerprint",
                vec![fact("path", path_key)],
                Some("rebuildIndex"),
            ));
        }
        if let Some(error) = parser_error_for_path(&connection, &root_key, &path_key)? {
            return Ok(result(
                "parserFailed",
                "File parser failed while building index data",
                vec![fact("parser", error)],
                Some("reportBug"),
            ));
        }
    }

    if request.kind == "api" && !has_active_sdk(&connection, &root_key)? {
        return Ok(result(
            "sdkNotReady",
            "SDK API index is not ready for this workspace",
            vec![fact("query", request.query.clone())],
            Some("configureSdk"),
        ));
    }

    if let Some(error) = latest_task_failure(&connection, &root_key)? {
        return Ok(result(
            "stale",
            "Latest workspace index task failed",
            vec![fact("task", error)],
            Some("rebuildIndex"),
        ));
    }

    Ok(result(
        "notIndexed",
        "No indexed evidence explains this query yet",
        vec![fact("query", request.query.clone())],
        Some("rebuildIndex"),
    ))
}

fn result(
    status: &str,
    message: &str,
    facts: Vec<WorkspaceIndexExplainFact>,
    recommended_action: Option<&str>,
) -> WorkspaceIndexExplainResult {
    WorkspaceIndexExplainResult {
        status: status.to_string(),
        message: message.to_string(),
        facts,
        recommended_action: recommended_action.map(str::to_string),
    }
}

fn fact(category: &str, evidence: String) -> WorkspaceIndexExplainFact {
    WorkspaceIndexExplainFact {
        category: category.to_string(),
        evidence,
    }
}

fn has_fingerprint(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(
                select 1 from workspace_file_fingerprints
                where root_path = ?1 and path = ?2
             )",
            params![root_key, path_key],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())
}

fn has_active_sdk(connection: &Connection, root_key: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(
                select 1 from workspace_sdk_index_metadata
                where root_path = ?1
             )",
            params![root_key],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())
}

fn parser_error_for_path(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<Option<String>, String> {
    if !table_exists(connection, "workspace_stub_parse_errors")? {
        return Ok(None);
    }
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

fn latest_task_failure(connection: &Connection, root_key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select coalesce(error, message)
             from workspace_index_task_journal
             where root_path = ?1 and status = 'failed'
             order by generation desc, updated_at desc
             limit 1",
            params![root_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(
                select 1 from sqlite_master
                where type = 'table' and name = ?1
             )",
            params![table_name],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    Connection::open(sqlite_catalog_cache_path(root_path)).map_err(|error| error.to_string())
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
