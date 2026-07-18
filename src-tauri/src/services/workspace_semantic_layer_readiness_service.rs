use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace_index_layer::{
    WorkspaceIndexLayerReadiness, WorkspaceIndexLayerStatus,
};
use crate::services::workspace_semantic_layer_state_service::SEMANTIC_LAYERS;

pub(crate) fn semantic_layer_readiness(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
) -> Result<Vec<WorkspaceIndexLayerReadiness>, String> {
    SEMANTIC_LAYERS
        .iter()
        .map(|layer| semantic_layer(connection, root_key, current_file_path, layer))
        .collect()
}

fn semantic_layer(
    connection: &Connection,
    root_key: &str,
    current_file_path: Option<&str>,
    layer: &str,
) -> Result<WorkspaceIndexLayerReadiness, String> {
    let counts = connection
        .query_row(
            "select
                sum(case when status = 'ready' then 1 else 0 end),
                sum(case when status = 'partial' then 1 else 0 end),
                sum(case when status = 'failed' then 1 else 0 end),
                sum(case when status = 'stale' then 1 else 0 end),
                sum(case when status = 'building' then 1 else 0 end),
                count(*)
             from workspace_semantic_file_layers
             where root_path = ?1 and layer = ?2",
            params![root_key, layer],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let current_status = current_file_path
        .map(|path| load_current_status(connection, root_key, path, layer))
        .transpose()?
        .flatten();
    let status = aggregate_status(counts);
    let current_missing = current_file_path.is_some() && current_status.is_none();
    let reason = readiness_reason(layer, status, current_status, current_missing);
    let action = recommended_action(status, current_status, current_missing);
    Ok(WorkspaceIndexLayerReadiness {
        layer: format!("semantic.{layer}"),
        workspace_status: status,
        current_file_status: current_status
            .or(current_missing.then_some(WorkspaceIndexLayerStatus::Missing)),
        indexed_count: counts.0 + counts.1,
        failed_count: counts.2,
        stale_count: counts.3,
        reason,
        recommended_action: action.map(str::to_string),
    })
}

fn load_current_status(
    connection: &Connection,
    root_key: &str,
    path: &str,
    layer: &str,
) -> Result<Option<WorkspaceIndexLayerStatus>, String> {
    connection
        .query_row(
            "select status from workspace_semantic_file_layers
             where root_path = ?1 and path = ?2 and layer = ?3",
            params![root_key, normalize_path(path), layer],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|status| status.map(|status| status_from_text(&status)))
        .map_err(|error| error.to_string())
}

fn aggregate_status(counts: (i64, i64, i64, i64, i64, i64)) -> WorkspaceIndexLayerStatus {
    let (ready, partial, failed, stale, building, total) = counts;
    if total == 0 {
        WorkspaceIndexLayerStatus::Missing
    } else if failed == total {
        WorkspaceIndexLayerStatus::Failed
    } else if partial > 0 || failed > 0 || stale > 0 || building > 0 || ready < total {
        WorkspaceIndexLayerStatus::Partial
    } else {
        WorkspaceIndexLayerStatus::Ready
    }
}

fn status_from_text(status: &str) -> WorkspaceIndexLayerStatus {
    match status {
        "ready" => WorkspaceIndexLayerStatus::Ready,
        "partial" | "building" => WorkspaceIndexLayerStatus::Partial,
        "stale" => WorkspaceIndexLayerStatus::Stale,
        "failed" => WorkspaceIndexLayerStatus::Failed,
        _ => WorkspaceIndexLayerStatus::Missing,
    }
}

fn readiness_reason(
    layer: &str,
    status: WorkspaceIndexLayerStatus,
    current: Option<WorkspaceIndexLayerStatus>,
    current_missing: bool,
) -> Option<String> {
    if current_missing {
        return Some(format!("Current file has no published {layer} generation."));
    }
    if matches!(current, Some(WorkspaceIndexLayerStatus::Stale)) {
        return Some(format!("Current file {layer} generation is stale."));
    }
    if matches!(current, Some(WorkspaceIndexLayerStatus::Failed)) {
        return Some(format!("Current file {layer} generation failed."));
    }
    (!matches!(status, WorkspaceIndexLayerStatus::Ready))
        .then(|| format!("Workspace {layer} generations are not fully ready."))
}

fn recommended_action(
    status: WorkspaceIndexLayerStatus,
    current: Option<WorkspaceIndexLayerStatus>,
    current_missing: bool,
) -> Option<&'static str> {
    if current_missing
        || matches!(
            current,
            Some(WorkspaceIndexLayerStatus::Stale) | Some(WorkspaceIndexLayerStatus::Failed)
        )
    {
        Some("indexCurrentFile")
    } else if matches!(status, WorkspaceIndexLayerStatus::Partial) {
        Some("wait")
    } else {
        None
    }
}

fn normalize_path(path: &str) -> String {
    path.replace('/', "\\")
}
