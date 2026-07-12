use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::{
    WorkspaceIndexEvent, WorkspaceIndexExplainFact, WorkspaceIndexExplainRequest,
    WorkspaceIndexExplainResult,
};
use crate::services::workspace_index_event_service::store_index_event;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_service::should_exclude;

#[allow(dead_code)]
pub fn explain_and_record_workspace_index_query(
    request: &WorkspaceIndexExplainRequest,
) -> Result<WorkspaceIndexExplainResult, String> {
    explain_and_record_workspace_index_query_with_event(request).map(|(result, _)| result)
}

pub fn explain_and_record_workspace_index_query_with_event(
    request: &WorkspaceIndexExplainRequest,
) -> Result<(WorkspaceIndexExplainResult, WorkspaceIndexEvent), String> {
    let result = explain_workspace_index_query(request)?;
    let event = event_from_explain_result(request, &result);
    store_index_event(&request.root_path, &event)?;
    Ok((result, event))
}

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
            let discovery_status = if has_discovered_file(&connection, &root_key, &path_key)? {
                "ready"
            } else {
                "missing"
            };
            return Ok(result(
                "notIndexed",
                "File has no index fingerprint",
                vec![
                    fact("path", path_key),
                    fact("layer", format!("discovery={discovery_status}")),
                    fact("layer", "fileCatalog=missing".to_string()),
                ],
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
        if needs_symbol_layer(&request.kind)
            && !has_symbol_layer(&connection, &root_key, &path_key)?
        {
            return Ok(result(
                "partial",
                "File catalog is ready but symbol index is not ready for this query",
                vec![
                    fact("path", path_key),
                    fact("layer", "fileCatalog=ready".to_string()),
                    fact("layer", "symbols=missing".to_string()),
                ],
                Some("rebuildIndex"),
            ));
        }
        if needs_content_layer(&request.kind)
            && !has_row(&connection, "workspace_content_lines", &root_key, &path_key)?
        {
            return Ok(result(
                "partial",
                "File catalog is ready but content index is not ready for this query",
                vec![
                    fact("path", path_key),
                    fact("layer", "fileCatalog=ready".to_string()),
                    fact("layer", "content=missing".to_string()),
                ],
                Some("rebuildIndex"),
            ));
        }
        if needs_reference_layer(&request.kind)
            && !has_row(
                &connection,
                "workspace_symbol_references",
                &root_key,
                &path_key,
            )?
        {
            return Ok(result(
                "partial",
                "File catalog is ready but reference index is not ready for this query",
                vec![
                    fact("path", path_key),
                    fact("layer", "fileCatalog=ready".to_string()),
                    fact("layer", "references=missing".to_string()),
                ],
                Some("rebuildIndex"),
            ));
        }
    }

    if request.kind == "api" && !has_active_sdk(&connection, &root_key)? {
        return Ok(result(
            "sdkNotReady",
            "SDK API index is not ready for this workspace",
            vec![
                fact("query", request.query.clone()),
                fact("layer", "sdk=missing".to_string()),
            ],
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

fn event_from_explain_result(
    request: &WorkspaceIndexExplainRequest,
    result: &WorkspaceIndexExplainResult,
) -> WorkspaceIndexEvent {
    let created_at = current_time_millis();
    let event_nonce = current_time_nanos();
    WorkspaceIndexEvent {
        event_id: format!(
            "query:{}:{}:{event_nonce}",
            request.kind,
            normalize_index_path(&request.query)
        ),
        root_path: normalize_index_path(&request.root_path),
        scope: "query".to_string(),
        kind: request.kind.to_string(),
        phase: explain_event_phase(&result.status).to_string(),
        severity: explain_event_severity(&result.status).to_string(),
        message: result.message.to_string(),
        task_id: None,
        generation: None,
        payload_json: explain_event_payload(request, result),
        created_at,
    }
}

fn current_time_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn explain_event_phase(status: &str) -> &'static str {
    match status {
        "ready" | "hit" => "hit",
        "sdkNotReady" | "stale" => "blocked",
        _ => "miss",
    }
}

fn explain_event_severity(status: &str) -> &'static str {
    match status {
        "ready" | "hit" => "info",
        _ => "warning",
    }
}

fn explain_event_payload(
    request: &WorkspaceIndexExplainRequest,
    result: &WorkspaceIndexExplainResult,
) -> String {
    serde_json::json!({
        "query": request.query,
        "path": request.path,
        "line": request.line,
        "column": request.column,
        "status": result.status,
        "recommendedAction": result.recommended_action,
        "facts": result.facts,
    })
    .to_string()
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

fn needs_symbol_layer(kind: &str) -> bool {
    matches!(kind, "definition" | "symbol" | "usage" | "completion")
}

fn needs_content_layer(kind: &str) -> bool {
    matches!(kind, "text" | "textSearch" | "search")
}

fn needs_reference_layer(kind: &str) -> bool {
    matches!(kind, "usage" | "usages")
}

fn has_symbol_layer(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<bool, String> {
    let declarations = has_row(connection, "workspace_symbol_entities", root_key, path_key)?;
    let references = has_row(
        connection,
        "workspace_symbol_references",
        root_key,
        path_key,
    )?;
    let stubs = has_row(connection, "workspace_stub_files", root_key, path_key)?;
    Ok(declarations || references || stubs)
}

fn has_row(
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

fn has_discovered_file(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(
                select 1 from workspace_discovered_files
                where root_path = ?1 and path = ?2 and excluded = 0
             )",
            params![root_key, path_key],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())
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
