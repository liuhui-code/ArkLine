use std::fs;

use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;
use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_discovery_store_service::{
    update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn reports_missing_layers_for_empty_workspace() {
    let root = create_empty_workspace("layer-readiness-empty");
    let root_path = root.to_string_lossy().to_string();

    let report = get_workspace_index_layer_readiness(&root_path, None).unwrap();

    assert_eq!(report.root_path, root_path.replace('/', "\\"));
    assert_eq!(
        report.layer("discovery").unwrap().workspace_status,
        WorkspaceIndexLayerStatus::Missing
    );
    assert_eq!(
        report.layer("fileCatalog").unwrap().workspace_status,
        WorkspaceIndexLayerStatus::Missing
    );
    assert_eq!(
        report.layer("sdk").unwrap().workspace_status,
        WorkspaceIndexLayerStatus::Missing
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn readiness_report_exposes_four_index_layers() {
    let root = create_empty_workspace("four-layer-readiness");
    let root_path = root.to_string_lossy().to_string();

    let report = get_workspace_index_layer_readiness(&root_path, None).unwrap();
    let layer_names = report
        .layers
        .iter()
        .map(|layer| layer.layer.as_str())
        .collect::<Vec<_>>();

    assert!(layer_names.contains(&"fileHot"));
    assert!(layer_names.contains(&"projectFile"));
    assert!(layer_names.contains(&"projectDeep"));
    assert!(layer_names.contains(&"sdkApi"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_layers_explain_user_visible_ide_impact() {
    let root = create_empty_workspace("layer-readiness-impact-reasons");
    let root_path = root.to_string_lossy().to_string();

    let report = get_workspace_index_layer_readiness(&root_path, None).unwrap();

    let project_deep = report.layer("projectDeep").unwrap();
    assert_eq!(
        project_deep.reason.as_deref(),
        Some("Deep project indexes are empty; text search, usages, and dependency-aware navigation are not ready.")
    );
    assert_eq!(project_deep.recommended_action.as_deref(), Some("wait"));
    let sdk_api = report.layer("sdkApi").unwrap();
    assert_eq!(
        sdk_api.reason.as_deref(),
        Some("SDK API symbols are not indexed; system API completion and navigation are unavailable.")
    );
    assert_eq!(sdk_api.recommended_action.as_deref(), Some("configureSdk"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_ready_current_file_layers_after_indexing() {
    let root = create_empty_workspace("layer-readiness-current-file");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("EntryBackupAbility.ets");
    fs::write(&path, "export class EntryBackupAbility { build() {} }\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let report = get_workspace_index_layer_readiness(&root_path, Some(&file_path)).unwrap();

    assert_eq!(
        report.layer("fileCatalog").unwrap().current_file_status,
        Some(WorkspaceIndexLayerStatus::Ready)
    );
    assert_eq!(
        report.layer("content").unwrap().current_file_status,
        Some(WorkspaceIndexLayerStatus::Ready)
    );
    assert_eq!(
        report.layer("stub").unwrap().current_file_status,
        Some(WorkspaceIndexLayerStatus::Ready)
    );
    assert_eq!(
        report.layer("symbols").unwrap().current_file_status,
        Some(WorkspaceIndexLayerStatus::Ready)
    );
    assert_eq!(
        report.layer("sdk").unwrap().workspace_status,
        WorkspaceIndexLayerStatus::Missing
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_partial_discovery_layer() {
    let root = create_empty_workspace("layer-readiness-discovery-partial");
    let root_path = root.to_string_lossy().to_string();

    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "partial".to_string(),
        discovered_count: 12,
        excluded_count: 3,
        cursor: Some(WorkspaceDiscoveryCursor {
            pending_directories: vec![root.join("entry").to_string_lossy().to_string()],
        }),
        error: None,
    })
    .unwrap();
    let report = get_workspace_index_layer_readiness(&root_path, None).unwrap();

    let discovery = report.layer("discovery").unwrap();
    assert_eq!(
        discovery.workspace_status,
        WorkspaceIndexLayerStatus::Partial
    );
    assert_eq!(discovery.indexed_count, 12);
    assert_eq!(discovery.failed_count, 3);
    assert_eq!(discovery.recommended_action.as_deref(), Some("wait"));

    fs::remove_dir_all(root).unwrap();
}
