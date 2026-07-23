use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace_index_layer::{
    WorkspaceIndexLayerReadiness, WorkspaceIndexLayerReadinessReport, WorkspaceIndexLayerStatus,
};
use crate::services::workspace_content_readiness_store_service::load_content_layer_summary;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_layer_readiness_store_service::{
    count_rows, normalize_layer_index_path as normalize_index_path, row_exists,
    with_layer_readiness_store,
};
use crate::services::workspace_index_layer_reason_service::enrich_layer_reason;
use crate::services::workspace_index_layer_status_service::{
    aggregate_count_status, file_hot_current_status, status_from_bool, status_from_count,
    status_from_text, status_with_failures,
};
use crate::services::workspace_sdk_shared_bridge_service::count_shared_sdk_symbols;
use crate::services::workspace_semantic_layer_readiness_service::semantic_layer_readiness;

pub fn get_workspace_index_layer_readiness(
    root_path: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadinessReport, String> {
    with_layer_readiness_store(root_path, |connection| {
        build_workspace_index_layer_readiness(connection, root_path, current_file_path)
    })
}

fn build_workspace_index_layer_readiness(
    connection: &Connection,
    root_path: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadinessReport, String> {
    let root_key = normalize_index_path(root_path);
    let current_file_key = current_file_path.map(normalize_index_path);
    let file_readiness = current_file_path
        .map(|path| get_workspace_index_file_readiness(root_path, path))
        .transpose()?;

    let mut layers = four_layer_projection(
        connection,
        &root_key,
        current_file_path,
        file_readiness.as_ref(),
    )?;
    layers.extend(vec![
        discovery_layer(connection, &root_key, current_file_path)?,
        counted_layer(
            connection,
            &root_key,
            "fileCatalog",
            "workspace_files",
            current_file_path,
        )?,
        counted_layer(
            connection,
            &root_key,
            "fingerprint",
            "workspace_file_fingerprints",
            current_file_path,
        )?,
        content_layer(connection, &root_key, file_readiness.as_ref())?,
        stub_layer(connection, &root_key, file_readiness.as_ref())?,
        symbol_layer(connection, &root_key, file_readiness.as_ref())?,
        reference_layer(connection, &root_key, current_file_path)?,
        counted_layer(
            connection,
            &root_key,
            "dependencyGraph",
            "workspace_dependency_edges",
            None,
        )?,
        sdk_layer(connection, &root_key)?,
    ]);
    layers.extend(semantic_layer_readiness(
        connection,
        &root_key,
        current_file_path,
    )?);

    Ok(WorkspaceIndexLayerReadinessReport {
        root_path: root_key.clone(),
        current_file_path: current_file_key,
        layers,
    })
}

fn four_layer_projection(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<Vec<WorkspaceIndexLayerReadiness>, String> {
    Ok(vec![
        file_hot_layer(connection, root_key, current_file_path, file_readiness)?,
        project_file_layer(connection, root_key, current_file_path)?,
        project_deep_layer(connection, root_key, current_file_path, file_readiness)?,
        sdk_api_layer(connection, root_key)?,
    ])
}

fn file_hot_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let file_count = count_rows(connection, "workspace_files", root_key)?;
    let symbol_count = count_rows(connection, "workspace_symbol_entities", root_key)?;
    let current = file_readiness.map(file_hot_current_status);
    Ok(layer_with_current(
        "fileHot",
        aggregate_count_status(&[file_count, symbol_count]),
        current,
        file_count.max(symbol_count),
        0,
        0,
        current_file_path.is_none().then_some("openFile"),
    ))
}

fn project_file_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let file_count = count_rows(connection, "workspace_files", root_key)?;
    let symbol_count = count_rows(connection, "workspace_symbol_entities", root_key)?;
    let current = current_file_path
        .map(|path| {
            row_exists(
                connection,
                "workspace_files",
                root_key,
                &normalize_index_path(path),
            )
        })
        .transpose()?
        .map(status_from_bool);
    Ok(layer_with_current(
        "projectFile",
        aggregate_count_status(&[file_count, symbol_count]),
        current,
        file_count.max(symbol_count),
        0,
        0,
        Some("rebuildIndex"),
    ))
}

fn project_deep_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
    file_readiness: Option<&crate::models::workspace::WorkspaceIndexFileReadiness>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let content = load_content_layer_summary(connection, root_key)?;
    let reference_count = count_rows(connection, "workspace_symbol_references", root_key)?;
    let dependency_count = count_rows(connection, "workspace_dependency_edges", root_key)?;
    let current = file_readiness
        .map(|readiness| status_from_text(&readiness.content_index))
        .or_else(|| current_file_path.map(|_| WorkspaceIndexLayerStatus::Missing));
    Ok(layer_with_current(
        "projectDeep",
        aggregate_count_status(&[content.ready_count, reference_count, dependency_count]),
        current,
        content.ready_count + reference_count + dependency_count,
        content.failed_count,
        0,
        Some("wait"),
    ))
}

fn sdk_api_layer(
    connection: &Connection,
    root_key: &str,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let count = sdk_symbol_count(connection, root_key)?;
    Ok(layer(
        "sdkApi",
        status_from_count(count),
        count,
        0,
        0,
        Some("configureSdk"),
    ))
}

fn discovery_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let row = connection
        .query_row(
            "select status, discovered_count, cursor_json
             from workspace_discovery_state where root_path = ?1 limit 1",
            params![root_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((status, discovered, cursor_json)) = row else {
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
    Ok(enrich_layer_reason(WorkspaceIndexLayerReadiness {
        layer: "discovery".to_string(),
        workspace_status,
        current_file_status: discovery_current_file_status(
            connection,
            root_key,
            current_file_path,
        )?,
        indexed_count: discovered,
        failed_count: 0,
        stale_count: 0,
        reason: has_more.then(|| "Discovery has a pending cursor".to_string()),
        recommended_action: (has_more || status == "partial").then(|| "wait".to_string()),
    }))
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
    let summary = load_content_layer_summary(connection, root_key)?;
    Ok(layer_with_current(
        "content",
        status_with_failures(summary.ready_count, summary.failed_count),
        file_readiness.map(|readiness| status_from_text(&readiness.content_index)),
        summary.ready_count,
        summary.failed_count,
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
    let count = sdk_symbol_count(connection, root_key)?;
    Ok(layer(
        "sdk",
        status_from_count(count),
        count,
        0,
        0,
        Some("configureSdk"),
    ))
}

fn sdk_symbol_count(connection: &Connection, root_key: &str) -> Result<i64, String> {
    let root_path = root_key.replace('\\', "/");
    if let Ok(Some(count)) = count_shared_sdk_symbols(&root_path) {
        return Ok(count);
    }
    count_rows(connection, "workspace_sdk_symbols", root_key)
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
    enrich_layer_reason(WorkspaceIndexLayerReadiness {
        layer: name.to_string(),
        workspace_status: status,
        current_file_status: current,
        indexed_count: indexed,
        failed_count: failed,
        stale_count: stale,
        reason: None,
        recommended_action: action.map(|value| value.to_string()),
    })
}
