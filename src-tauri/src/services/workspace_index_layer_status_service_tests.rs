use crate::models::workspace::WorkspaceIndexFileReadiness;
use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;
use crate::services::workspace_index_layer_status_service::{
    aggregate_count_status, file_hot_current_status, status_from_text, status_with_failures,
};

#[test]
fn aggregate_count_status_distinguishes_missing_partial_and_ready() {
    assert_eq!(
        aggregate_count_status(&[0, 0]),
        WorkspaceIndexLayerStatus::Missing
    );
    assert_eq!(
        aggregate_count_status(&[2, 0]),
        WorkspaceIndexLayerStatus::Partial
    );
    assert_eq!(
        aggregate_count_status(&[2, 3]),
        WorkspaceIndexLayerStatus::Ready
    );
}

#[test]
fn failure_count_takes_precedence_over_ready_count() {
    assert_eq!(
        status_with_failures(12, 1),
        WorkspaceIndexLayerStatus::Failed
    );
}

#[test]
fn file_hot_status_requires_file_symbol_and_parser_readiness() {
    assert_eq!(
        file_hot_current_status(&readiness("ready", "ready", "ready")),
        WorkspaceIndexLayerStatus::Ready
    );
    assert_eq!(
        file_hot_current_status(&readiness("ready", "missing", "ready")),
        WorkspaceIndexLayerStatus::Partial
    );
    assert_eq!(
        file_hot_current_status(&readiness("missing", "ready", "ready")),
        WorkspaceIndexLayerStatus::Missing
    );
}

#[test]
fn textual_status_maps_known_states_and_defaults_to_missing() {
    assert_eq!(status_from_text("ready"), WorkspaceIndexLayerStatus::Ready);
    assert_eq!(status_from_text("partial"), WorkspaceIndexLayerStatus::Partial);
    assert_eq!(status_from_text("stale"), WorkspaceIndexLayerStatus::Stale);
    assert_eq!(status_from_text("failed"), WorkspaceIndexLayerStatus::Failed);
    assert_eq!(status_from_text("other"), WorkspaceIndexLayerStatus::Missing);
}

fn readiness(
    file_index: &str,
    symbol_index: &str,
    parser_status: &str,
) -> WorkspaceIndexFileReadiness {
    WorkspaceIndexFileReadiness {
        root_path: "\\workspace".to_string(),
        path: "\\workspace\\Entry.ets".to_string(),
        file_name: "Entry.ets".to_string(),
        discovery_index: "ready".to_string(),
        file_index: file_index.to_string(),
        content_index: "missing".to_string(),
        symbol_index: symbol_index.to_string(),
        parser_status: parser_status.to_string(),
        parser_error: None,
        indexed_generation: None,
        definition_available: false,
        completion_available: false,
        usages_available: false,
        search_available: false,
        reason: String::new(),
    }
}
