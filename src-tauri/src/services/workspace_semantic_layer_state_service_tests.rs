use rusqlite::Connection;

use crate::services::workspace_semantic_layer_state_service::{
    create_semantic_layer_tables, load_semantic_layers, mark_semantic_layers_stale,
    publish_semantic_layer, remove_semantic_layers,
};

#[test]
fn ready_layer_with_zero_results_is_distinct_from_missing() {
    let connection = Connection::open_in_memory().unwrap();
    create_semantic_layer_tables(&connection).unwrap();

    publish_semantic_layer(
        &connection,
        "C:\\workspace",
        "C:\\workspace\\Index.ets",
        "definitions",
        "ready",
        7,
        0,
        None,
    )
    .unwrap();

    let layers =
        load_semantic_layers(&connection, "C:\\workspace", "C:\\workspace\\Index.ets").unwrap();
    let definitions = layer(&layers, "definitions");
    let types = layer(&layers, "types");
    assert_eq!(definitions.status, "ready");
    assert_eq!(definitions.result_count, 0);
    assert_eq!(definitions.source_generation, Some(7));
    assert_eq!(types.status, "missing");
    assert_eq!(types.source_generation, None);
}

#[test]
fn older_generation_cannot_replace_newer_semantic_evidence() {
    let connection = Connection::open_in_memory().unwrap();
    create_semantic_layer_tables(&connection).unwrap();
    let args = ("C:\\workspace", "C:\\workspace\\Index.ets", "syntax");

    publish_semantic_layer(&connection, args.0, args.1, args.2, "ready", 9, 3, None).unwrap();
    publish_semantic_layer(
        &connection,
        args.0,
        args.1,
        args.2,
        "failed",
        8,
        0,
        Some("late result"),
    )
    .unwrap();

    let layers = load_semantic_layers(&connection, args.0, args.1).unwrap();
    let syntax = layer(&layers, "syntax");
    assert_eq!(syntax.status, "ready");
    assert_eq!(syntax.source_generation, Some(9));
    assert_eq!(syntax.result_count, 3);
    assert_eq!(syntax.error, None);
}

#[test]
fn changed_and_removed_files_have_explicit_lifecycle() {
    let connection = Connection::open_in_memory().unwrap();
    create_semantic_layer_tables(&connection).unwrap();
    let root = "C:\\workspace";
    let path = "C:\\workspace\\Index.ets";
    publish_semantic_layer(&connection, root, path, "references", "ready", 4, 5, None).unwrap();

    mark_semantic_layers_stale(&connection, root, &[path.to_string()], 5).unwrap();
    let stale = load_semantic_layers(&connection, root, path).unwrap();
    assert_eq!(layer(&stale, "references").status, "stale");
    assert_eq!(layer(&stale, "references").source_generation, Some(5));

    remove_semantic_layers(&connection, root, &[path.to_string()]).unwrap();
    let removed = load_semantic_layers(&connection, root, path).unwrap();
    assert!(removed.iter().all(|item| item.status == "missing"));
}

fn layer<'a>(
    layers: &'a [crate::models::workspace_semantic_layer::WorkspaceSemanticLayerReadiness],
    name: &str,
) -> &'a crate::models::workspace_semantic_layer::WorkspaceSemanticLayerReadiness {
    layers.iter().find(|item| item.layer == name).unwrap()
}
