use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::WorkspaceIndexFileReadiness;
use crate::services::workspace_content_readiness_store_service::load_content_file_state;
use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;
use crate::services::workspace_semantic_layer_state_service::load_semantic_layers;

pub fn get_workspace_index_file_readiness(
    root_path: &str,
    file_path: &str,
) -> Result<WorkspaceIndexFileReadiness, String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(missing_file_readiness(root_path, file_path));
    };
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(file_path);
    let file_name = file_name(file_path);

    let discovery_ready = has_row(
        &connection,
        "workspace_discovered_files",
        "root_path = ?1 and path = ?2 and excluded = 0",
        &root_key,
        &path_key,
    )?;
    let file_ready = has_row(
        &connection,
        "workspace_files",
        "root_path = ?1 and path = ?2",
        &root_key,
        &path_key,
    )?;
    let content_state = load_content_file_state(&connection, &root_key, &path_key)?;
    let content_status = content_state
        .as_ref()
        .map(|state| state.status.as_str())
        .unwrap_or("missing");
    let content_error = content_state
        .as_ref()
        .and_then(|state| state.error.as_deref());
    let content_ready = content_status == "ready";
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
    let semantic_layers = load_semantic_layers(&connection, &root_key, &path_key)?;
    let has_semantic_evidence = semantic_layers
        .iter()
        .any(|layer| layer.source_generation.is_some());
    let parser_status = if parser_error.is_some() {
        "failed"
    } else if indexed_generation.is_some() {
        "ready"
    } else {
        "unknown"
    };
    let syntax_available = semantic_layer_available(&semantic_layers, "syntax");
    let definitions_ready = semantic_layer_available(&semantic_layers, "definitions");
    let references_ready = semantic_layer_available(&semantic_layers, "references");
    let definition_available = file_ready
        && parser_error.is_none()
        && if has_semantic_evidence {
            definitions_ready
        } else {
            symbol_ready
        };
    let completion_available =
        file_ready && parser_error.is_none() && (!has_semantic_evidence || syntax_available);
    let usages_available = file_ready
        && parser_error.is_none()
        && if has_semantic_evidence {
            references_ready
        } else {
            symbol_ready
        };
    let search_available = content_ready || Path::new(file_path).is_file();

    Ok(WorkspaceIndexFileReadiness {
        root_path: root_key,
        path: path_key,
        file_name: file_name.to_string(),
        discovery_index: layer_status(discovery_ready),
        file_index: layer_status(file_ready),
        content_index: content_status.to_string(),
        symbol_index: layer_status(symbol_ready),
        parser_status: parser_status.to_string(),
        parser_error,
        indexed_generation,
        semantic_layers,
        definition_available,
        completion_available,
        usages_available,
        search_available,
        reason: readiness_reason(
            &file_name,
            discovery_ready,
            file_ready,
            content_status,
            content_error,
            symbol_ready,
            parser_status,
        ),
    })
}

fn missing_file_readiness(root_path: &str, file_path: &str) -> WorkspaceIndexFileReadiness {
    let file_name = file_name(file_path);
    WorkspaceIndexFileReadiness {
        root_path: normalize_index_path(root_path),
        path: normalize_index_path(file_path),
        file_name: file_name.clone(),
        discovery_index: "missing".to_string(),
        file_index: "missing".to_string(),
        content_index: "missing".to_string(),
        symbol_index: "missing".to_string(),
        parser_status: "unknown".to_string(),
        parser_error: None,
        indexed_generation: None,
        semantic_layers: Vec::new(),
        definition_available: false,
        completion_available: false,
        usages_available: false,
        search_available: Path::new(file_path).is_file(),
        reason: readiness_reason(&file_name, false, false, "missing", None, false, "unknown"),
    }
}

fn semantic_layer_available(
    layers: &[crate::models::workspace_semantic_layer::WorkspaceSemanticLayerReadiness],
    name: &str,
) -> bool {
    layers
        .iter()
        .any(|layer| layer.layer == name && matches!(layer.status.as_str(), "ready" | "partial"))
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
    discovery_ready: bool,
    file_ready: bool,
    content_status: &str,
    content_error: Option<&str>,
    symbol_ready: bool,
    parser_status: &str,
) -> String {
    if parser_status == "failed" {
        return format!(
            "{file_name} is indexed but its parser failed; navigation may be incomplete."
        );
    }
    if !file_ready {
        if discovery_ready {
            return format!(
                "{file_name} was discovered but has not completed foreground file catalog indexing."
            );
        }
        return format!(
            "{file_name} is not indexed because it has not completed foreground indexing."
        );
    }
    if content_status == "failed" {
        return format!(
            "{file_name} text content indexing failed: {}.",
            content_error.unwrap_or("unknown read error")
        );
    }
    if !symbol_ready {
        return format!("{file_name} is in the file index but symbol data is not ready yet.");
    }
    if content_status != "ready" {
        return format!("{file_name} is in the file index but text search rows are not ready yet.");
    }
    format!("{file_name} is indexed and semantic navigation can use the workspace index.")
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
