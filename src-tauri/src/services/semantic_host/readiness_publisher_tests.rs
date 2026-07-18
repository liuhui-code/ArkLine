use std::fs;

use rusqlite::Connection;

use super::readiness_publisher::{publish_semantic_readiness_for_test, SemanticReadinessEvidence};
use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;
use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_semantic_layer_state_service::load_semantic_layers;

#[test]
fn worker_readiness_publishes_independent_content_and_dependency_generations() {
    let root = create_empty_workspace("semantic-readiness-publisher");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("Index.ets");
    fs::write(&path, "export class Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    migrate_workspace_index_schema(&root_path).unwrap();

    publish_semantic_readiness_for_test(&SemanticReadinessEvidence {
        path: path.to_string_lossy().to_string(),
        layer: "editorDefinitions".to_string(),
        content_generation: 8,
        dependency_generation: 13,
        result_count: 0,
        status: "ready".to_string(),
    })
    .unwrap();

    let connection = Connection::open(sqlite_catalog_cache_path(&root_path)).unwrap();
    let root_key = root_path.replace('/', "\\");
    let layers = load_semantic_layers(&connection, &root_key, &path.to_string_lossy()).unwrap();
    let definitions = layers
        .iter()
        .find(|layer| layer.layer == "editorDefinitions")
        .unwrap();
    assert_eq!(definitions.status, "ready");
    assert_eq!(definitions.source_generation, Some(8));
    assert_eq!(definitions.dependency_generation, Some(13));
    assert_eq!(definitions.result_count, 0);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_readiness_preserves_partial_type_evidence() {
    let root = create_empty_workspace("semantic-type-readiness-publisher");
    let source_dir = create_workspace_source_dir(&root);
    let path = source_dir.join("Index.ets");
    fs::write(&path, "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    migrate_workspace_index_schema(&root_path).unwrap();

    publish_semantic_readiness_for_test(&SemanticReadinessEvidence {
        path: path.to_string_lossy().to_string(),
        layer: "editorTypes".to_string(),
        content_generation: 3,
        dependency_generation: 5,
        result_count: 2,
        status: "partial".to_string(),
    })
    .unwrap();

    let connection = Connection::open(sqlite_catalog_cache_path(&root_path)).unwrap();
    let root_key = root_path.replace('/', "\\");
    let layers = load_semantic_layers(&connection, &root_key, &path.to_string_lossy()).unwrap();
    let types = layers
        .iter()
        .find(|layer| layer.layer == "editorTypes")
        .unwrap();
    assert_eq!(types.status, "partial");
    assert_eq!(types.source_generation, Some(3));
    assert_eq!(types.dependency_generation, Some(5));

    fs::remove_dir_all(root).unwrap();
}
