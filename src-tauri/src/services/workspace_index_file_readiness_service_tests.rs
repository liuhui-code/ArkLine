use std::fs;

use crate::services::workspace_discovery_service::WorkspaceDiscoveredFile;
use crate::services::workspace_discovery_store_service::replace_discovered_file_chunk;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn reports_current_file_ready_when_all_index_layers_have_rows() {
    let root = create_empty_workspace("file-readiness-ready");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("EntryBackupAbility.ets");
    fs::write(&path, "export class EntryBackupAbility { build() {} }\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let readiness = get_workspace_index_file_readiness(&root_path, &file_path).unwrap();

    assert_eq!(readiness.file_name, "EntryBackupAbility.ets");
    assert_eq!(readiness.file_index, "ready");
    assert_eq!(readiness.content_index, "ready");
    assert_eq!(readiness.symbol_index, "ready");
    assert_eq!(readiness.parser_status, "ready");
    assert!(readiness.indexed_generation.is_some());
    assert_eq!(semantic_status(&readiness, "syntax"), "ready");
    assert_eq!(semantic_status(&readiness, "projectModel"), "ready");
    assert_eq!(semantic_status(&readiness, "definitions"), "ready");
    assert_eq!(semantic_status(&readiness, "types"), "missing");
    assert_eq!(semantic_status(&readiness, "references"), "ready");
    assert!(readiness.definition_available);
    assert!(readiness.completion_available);
    assert!(readiness.usages_available);
    assert!(readiness.search_available);
    assert_eq!(
        readiness.reason,
        "EntryBackupAbility.ets is indexed and semantic navigation can use the workspace index."
    );

    fs::remove_dir_all(root).unwrap();
}

fn semantic_status<'a>(
    readiness: &'a crate::models::workspace::WorkspaceIndexFileReadiness,
    layer: &str,
) -> &'a str {
    readiness
        .semantic_layers
        .iter()
        .find(|item| item.layer == layer)
        .map(|item| item.status.as_str())
        .unwrap()
}

#[test]
fn reports_discovered_file_before_file_catalog_indexing() {
    let root = create_empty_workspace("file-readiness-discovered-only");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("EntryBackupAbility.ets");
    fs::write(&path, "export class EntryBackupAbility {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();

    replace_discovered_file_chunk(
        &root_path,
        1,
        &[WorkspaceDiscoveredFile {
            path: file_path.clone(),
            size_bytes: 32,
            modified_ms: Some(1),
        }],
    )
    .unwrap();

    let readiness = get_workspace_index_file_readiness(&root_path, &file_path).unwrap();

    assert_eq!(readiness.discovery_index, "ready");
    assert_eq!(readiness.file_index, "missing");
    assert_eq!(
        readiness.reason,
        "EntryBackupAbility.ets was discovered but has not completed foreground file catalog indexing."
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_lazy_tree_file_that_has_not_entered_foreground_indexing() {
    let root = create_empty_workspace("file-readiness-lazy-missing");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("EntryBackupAbility.ets");
    fs::write(&path, "export class EntryBackupAbility {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();

    let readiness = get_workspace_index_file_readiness(&root_path, &file_path).unwrap();

    assert_eq!(readiness.discovery_index, "missing");
    assert_eq!(readiness.file_index, "missing");
    assert_eq!(readiness.content_index, "missing");
    assert_eq!(readiness.symbol_index, "missing");
    assert_eq!(readiness.parser_status, "unknown");
    assert_eq!(readiness.indexed_generation, None);
    assert!(!readiness.definition_available);
    assert!(readiness.search_available);
    assert_eq!(
        readiness.reason,
        "EntryBackupAbility.ets is not indexed because it has not completed foreground indexing."
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_empty_file_content_as_ready_without_requiring_a_content_row() {
    let root = create_empty_workspace("file-readiness-empty-content");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("Empty.ets");
    fs::write(&path, "").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let readiness = get_workspace_index_file_readiness(&root_path, &file_path).unwrap();

    assert_eq!(readiness.content_index, "ready");
    assert!(readiness.search_available);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_persisted_content_read_failure_instead_of_missing() {
    let root = create_empty_workspace("file-readiness-content-failed");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("Unreadable.ets");
    fs::write(&path, "export class Unreadable {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = path.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let connection =
        rusqlite::Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
    connection
        .execute(
            "update workspace_content_files set status = 'failed', error = 'fixture read failure'",
            [],
        )
        .unwrap();

    let readiness = get_workspace_index_file_readiness(&root_path, &file_path).unwrap();

    assert_eq!(readiness.content_index, "failed");
    assert!(readiness.reason.contains("fixture read failure"));
    fs::remove_dir_all(root).unwrap();
}
