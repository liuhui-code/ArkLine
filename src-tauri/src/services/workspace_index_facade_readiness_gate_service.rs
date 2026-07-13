use crate::models::workspace::{WorkspaceIndexReadiness, WorkspaceIndexReadinessState};
use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness;

pub(crate) fn gate_workspace_layer(
    root_path: &str,
    readiness: &mut WorkspaceIndexReadiness,
    layer_name: &str,
    skipped_index: &str,
    reason: &str,
) -> Result<Vec<String>, String> {
    let report = get_workspace_index_layer_readiness(root_path, None)?;
    let missing = report
        .layers
        .iter()
        .find(|layer| layer.layer == layer_name)
        .map(|layer| layer.workspace_status != WorkspaceIndexLayerStatus::Ready)
        .unwrap_or(true);
    if !missing {
        return Ok(Vec::new());
    }
    downgrade_to_partial(readiness, reason);
    Ok(vec![format!("skipped:{skipped_index}:missing")])
}

pub(crate) fn gate_current_file_catalog(
    root_path: &str,
    file_path: &str,
    readiness: &mut WorkspaceIndexReadiness,
) -> Result<Vec<String>, String> {
    let file = get_workspace_index_file_readiness(root_path, file_path)?;
    if file.file_index == "ready" {
        return Ok(Vec::new());
    }
    downgrade_to_partial(
        readiness,
        "Current file catalog is missing; served retryable fallback",
    );
    Ok(vec!["skipped:CurrentFileIndex:missing".to_string()])
}

fn downgrade_to_partial(readiness: &mut WorkspaceIndexReadiness, reason: &str) {
    if readiness.state == WorkspaceIndexReadinessState::Ready {
        readiness.state = WorkspaceIndexReadinessState::Partial;
        readiness.retryable = true;
        readiness.reason = Some(reason.to_string());
        return;
    }
    if readiness.reason.is_none() {
        readiness.reason = Some(reason.to_string());
    }
}
