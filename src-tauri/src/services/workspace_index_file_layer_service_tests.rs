use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_service::scan_workspace;

#[test]
fn file_symbol_layer_updates_files_and_symbols_without_stub_rows() {
    let root = create_empty_workspace("workspace-index-file-layer");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let source_file = source_dir.join("LayerOnly.ets");
    fs::write(&source_file, "export class LayerOnly {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source_file.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let snapshot = scan_workspace(root.as_path()).unwrap();
    runtime
        .index_workspace_snapshot_for_open(&snapshot)
        .unwrap();

    runtime
        .update_workspace_file_symbol_layer(&root_path, &[source_path.clone()], &[])
        .unwrap();
    let results = runtime
        .query_search_everywhere(&root_path, "LayerOnly", 8)
        .unwrap();
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let file_count: i64 = connection
        .query_row(
            "select count(*) from workspace_files where path = ?1",
            [source_path.replace('/', "\\")],
            |row| row.get(0),
        )
        .unwrap();
    let stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    let fingerprint_versions: (i64, i64, i64) = connection
        .query_row(
            "select content_index_version, symbol_index_version, stub_parser_version
             from workspace_file_fingerprints where path = ?1",
            [source_path.replace('/', "\\")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let content_freshness = diagnostics
        .freshness_layers
        .iter()
        .find(|layer| layer.layer == "content")
        .unwrap();

    assert!(results.iter().any(|result| result.title == "LayerOnly"));
    assert_eq!(file_count, 1);
    assert_eq!(stub_count, 0);
    assert_eq!(fingerprint_versions, (0, 0, 0));
    assert_eq!(content_freshness.ready_count, 0);
    assert_eq!(content_freshness.missing_count, 1);

    runtime
        .update_workspace_deep_layer(&root_path, &[source_path.clone()], &[])
        .unwrap();
    let deep_stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    let deep_fingerprint_versions: (i64, i64, i64) = connection
        .query_row(
            "select content_index_version, symbol_index_version, stub_parser_version
             from workspace_file_fingerprints where path = ?1",
            [source_path.replace('/', "\\")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let deep_diagnostics = inspect_workspace_index(&root_path).unwrap();
    let deep_content_freshness = deep_diagnostics
        .freshness_layers
        .iter()
        .find(|layer| layer.layer == "content")
        .unwrap();

    assert_eq!(deep_stub_count, 1);
    assert_eq!(deep_fingerprint_versions, (1, 1, 1));
    assert_eq!(deep_content_freshness.ready_count, 1);
    assert_eq!(deep_content_freshness.missing_count, 0);

    fs::remove_dir_all(root).unwrap();
}
