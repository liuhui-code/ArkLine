use std::fs;
use std::io::Cursor;

use super::protocol::IndexerResponse;
use super::stdio::run_stream;
use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

#[test]
fn discovery_prepare_writes_an_artifact_without_publishing_sqlite_rows() {
    let root = std::env::temp_dir().join(format!(
        "arkline-sidecar-discovery-prepare-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Entry.ets"), "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let request = serde_json::json!({
        "id": "prepare-discovery",
        "method": "prepareDiscoveryChunk",
        "payload": {
            "task": {
                "rootPath": root_path,
                "kind": "discovery",
                "generation": 1,
                "reason": "test"
            },
            "limit": 64
        }
    });
    let mut output = Vec::new();

    run_stream(Cursor::new(format!("{request}\n")), &mut output).unwrap();

    let response: IndexerResponse = serde_json::from_slice(&output).unwrap();
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.payload["chunkFileCount"], 1);
    assert!(response.payload["publicationArtifact"]["path"]
        .as_str()
        .is_some_and(|path| path.ends_with(".json")));
    assert!(open_existing_workspace_index_reader(
        response.payload["task"]["rootPath"].as_str().unwrap(),
    )
    .unwrap()
    .is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_prepare_writes_an_artifact_without_publishing_sqlite_rows() {
    let root = std::env::temp_dir().join(format!(
        "arkline-sidecar-content-prepare-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let request = serde_json::json!({
        "id": "prepare-content",
        "method": "prepareContentChunk",
        "payload": {
            "task": {
                "rootPath": root_path,
                "kind": "content-refresh",
                "generation": 2,
                "reason": "test"
            },
            "indexedGeneration": 1,
            "changedPaths": [source_path],
            "removedPaths": [],
            "priority": "background"
        }
    });
    let mut output = Vec::new();

    run_stream(Cursor::new(format!("{request}\n")), &mut output).unwrap();

    let response: IndexerResponse = serde_json::from_slice(&output).unwrap();
    assert!(response.ok, "{:?}", response.error);
    assert!(response.payload["publicationArtifact"]["path"]
        .as_str()
        .is_some_and(|path| path.ends_with(".json")));
    let connection = open_existing_workspace_index_reader(
        response.payload["task"]["rootPath"].as_str().unwrap(),
    )
    .unwrap()
    .unwrap();
    let content_count: i64 = connection
        .query_row("select count(*) from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(content_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stub_prepare_writes_an_artifact_without_publishing_sqlite_rows() {
    let root = std::env::temp_dir().join(format!(
        "arkline-sidecar-stub-prepare-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let request = serde_json::json!({
        "id": "prepare-stub",
        "method": "prepareStubChunk",
        "payload": {
            "task": {
                "rootPath": root_path,
                "kind": "stub-refresh",
                "generation": 3,
                "reason": "test"
            },
            "indexedGeneration": 1,
            "changedPaths": [source_path],
            "removedPaths": [],
            "priority": "background"
        }
    });
    let mut output = Vec::new();

    run_stream(Cursor::new(format!("{request}\n")), &mut output).unwrap();

    let response: IndexerResponse = serde_json::from_slice(&output).unwrap();
    assert!(response.ok, "{:?}", response.error);
    assert!(response.payload["publicationArtifact"]["path"]
        .as_str()
        .is_some_and(|path| path.ends_with(".json")));
    let connection = open_existing_workspace_index_reader(
        response.payload["task"]["rootPath"].as_str().unwrap(),
    )
    .unwrap()
    .unwrap();
    let stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stub_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}
