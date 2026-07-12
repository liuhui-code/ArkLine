use crate::models::workspace::WorkspaceIndexFileReadiness;
use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;

pub(crate) fn status_from_count(count: i64) -> WorkspaceIndexLayerStatus {
    status_from_bool(count > 0)
}

pub(crate) fn aggregate_count_status(counts: &[i64]) -> WorkspaceIndexLayerStatus {
    if counts.iter().all(|count| *count > 0) {
        WorkspaceIndexLayerStatus::Ready
    } else if counts.iter().any(|count| *count > 0) {
        WorkspaceIndexLayerStatus::Partial
    } else {
        WorkspaceIndexLayerStatus::Missing
    }
}

pub(crate) fn file_hot_current_status(
    readiness: &WorkspaceIndexFileReadiness,
) -> WorkspaceIndexLayerStatus {
    if readiness.file_index == "ready"
        && readiness.symbol_index == "ready"
        && readiness.parser_status == "ready"
    {
        WorkspaceIndexLayerStatus::Ready
    } else if readiness.file_index == "missing" {
        WorkspaceIndexLayerStatus::Missing
    } else {
        WorkspaceIndexLayerStatus::Partial
    }
}

pub(crate) fn status_with_failures(count: i64, failures: i64) -> WorkspaceIndexLayerStatus {
    if failures > 0 {
        WorkspaceIndexLayerStatus::Failed
    } else {
        status_from_count(count)
    }
}

pub(crate) fn status_from_bool(value: bool) -> WorkspaceIndexLayerStatus {
    if value {
        WorkspaceIndexLayerStatus::Ready
    } else {
        WorkspaceIndexLayerStatus::Missing
    }
}

pub(crate) fn status_from_text(value: &str) -> WorkspaceIndexLayerStatus {
    match value {
        "ready" => WorkspaceIndexLayerStatus::Ready,
        "partial" => WorkspaceIndexLayerStatus::Partial,
        "stale" => WorkspaceIndexLayerStatus::Stale,
        "failed" => WorkspaceIndexLayerStatus::Failed,
        _ => WorkspaceIndexLayerStatus::Missing,
    }
}
