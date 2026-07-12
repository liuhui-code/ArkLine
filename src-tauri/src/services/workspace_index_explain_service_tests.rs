use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexExplainRequest;
use crate::services::workspace_discovery_service::WorkspaceDiscoveredFile;
use crate::services::workspace_discovery_store_service::replace_discovered_file_chunk;
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_explain_service::{
    explain_and_record_workspace_index_query, explain_and_record_workspace_index_query_with_event,
    explain_workspace_index_query,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn index_connection(root: &PathBuf) -> Connection {
    let index_dir = root.join(".arkline").join("index");
    fs::create_dir_all(&index_dir).unwrap();
    let connection = Connection::open(index_dir.join("workspace-catalog.sqlite")).unwrap();
    ensure_workspace_index_schema(&connection).unwrap();
    connection
}

fn request(root: &PathBuf, kind: &str, path: Option<String>) -> WorkspaceIndexExplainRequest {
    WorkspaceIndexExplainRequest {
        root_path: root.to_string_lossy().to_string(),
        kind: kind.to_string(),
        query: "Target".to_string(),
        path,
        line: None,
        column: None,
    }
}

#[test]
fn explains_excluded_paths_before_touching_index_rows() {
    let root = unique_temp_dir("explain-excluded");
    fs::create_dir_all(root.join("node_modules")).unwrap();
    index_connection(&root);

    let result = explain_workspace_index_query(&request(
        &root,
        "symbol",
        Some(
            root.join("node_modules")
                .join("pkg.ets")
                .to_string_lossy()
                .to_string(),
        ),
    ))
    .unwrap();

    assert_eq!(result.status, "excluded");
    assert_eq!(result.recommended_action.as_deref(), Some("openFile"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_missing_fingerprint_as_not_indexed() {
    let root = unique_temp_dir("explain-not-indexed");
    fs::create_dir_all(root.join("src")).unwrap();
    index_connection(&root);
    let path = root.join("src").join("Missing.ets");
    fs::write(&path, "class Missing {}\n").unwrap();

    let result = explain_workspace_index_query(&request(
        &root,
        "symbol",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "notIndexed");
    assert_eq!(result.recommended_action.as_deref(), Some("rebuildIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn records_and_returns_query_event_for_live_emit() {
    let root = unique_temp_dir("explain-live-event");
    fs::create_dir_all(root.join("src")).unwrap();
    index_connection(&root);
    let path = root.join("src").join("Missing.ets");
    fs::write(&path, "class Missing {}\n").unwrap();

    let (result, event) = explain_and_record_workspace_index_query_with_event(&request(
        &root,
        "definition",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();
    let events = load_recent_index_events(&root.to_string_lossy(), 4).unwrap();

    assert_eq!(result.status, "notIndexed");
    assert_eq!(event.scope, "query");
    assert_eq!(event.kind, "definition");
    assert_eq!(event.phase, "miss");
    assert_eq!(event.severity, "warning");
    assert!(events.iter().any(|stored| stored.event_id == event.event_id));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_discovered_file_missing_catalog_with_layer_facts() {
    let root = unique_temp_dir("explain-discovered-missing-catalog");
    let source_dir = root.join("src");
    fs::create_dir_all(&source_dir).unwrap();
    index_connection(&root);
    let path = source_dir.join("Discovered.ets");
    fs::write(&path, "class Discovered {}\n").unwrap();
    replace_discovered_file_chunk(
        &root.to_string_lossy(),
        1,
        &[WorkspaceDiscoveredFile {
            path: path.to_string_lossy().to_string(),
            size_bytes: 20,
            modified_ms: Some(1),
        }],
    )
    .unwrap();

    let result = explain_workspace_index_query(&request(
        &root,
        "definition",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "notIndexed");
    assert_eq!(result.recommended_action.as_deref(), Some("rebuildIndex"));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "discovery=ready" }));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "fileCatalog=missing" }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn records_query_explain_misses_as_unified_index_events() {
    let root = unique_temp_dir("explain-records-query-miss");
    fs::create_dir_all(root.join("src")).unwrap();
    index_connection(&root);
    let path = root.join("src").join("Missing.ets");
    fs::write(&path, "class Missing {}\n").unwrap();

    let result = explain_and_record_workspace_index_query(&request(
        &root,
        "symbol",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();
    let events = load_recent_index_events(&root.to_string_lossy(), 8).unwrap();

    assert_eq!(result.status, "notIndexed");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].scope, "query");
    assert_eq!(events[0].kind, "symbol");
    assert_eq!(events[0].phase, "miss");
    assert_eq!(events[0].severity, "warning");
    assert_eq!(events[0].message, "File has no index fingerprint");
    assert!(events[0]
        .payload_json
        .contains("\"recommendedAction\":\"rebuildIndex\""));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_api_queries_without_active_sdk_as_sdk_not_ready() {
    let root = unique_temp_dir("explain-sdk-not-ready");
    fs::create_dir_all(&root).unwrap();
    index_connection(&root);

    let result = explain_workspace_index_query(&request(&root, "api", None)).unwrap();

    assert_eq!(result.status, "sdkNotReady");
    assert_eq!(result.recommended_action.as_deref(), Some("configureSdk"));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "sdk=missing" }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn records_sdk_not_ready_explain_as_blocked_query_event() {
    let root = unique_temp_dir("explain-records-sdk-blocked");
    fs::create_dir_all(&root).unwrap();
    index_connection(&root);

    let result = explain_and_record_workspace_index_query(&request(&root, "api", None)).unwrap();
    let events = load_recent_index_events(&root.to_string_lossy(), 8).unwrap();

    assert_eq!(result.status, "sdkNotReady");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].scope, "query");
    assert_eq!(events[0].kind, "api");
    assert_eq!(events[0].phase, "blocked");
    assert_eq!(events[0].severity, "warning");
    assert!(events[0]
        .payload_json
        .contains("\"recommendedAction\":\"configureSdk\""));
    assert!(events[0].payload_json.contains("sdk=missing"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_parser_errors_when_stub_error_rows_exist() {
    let root = unique_temp_dir("explain-parser-failed");
    let source_dir = root.join("src");
    fs::create_dir_all(&source_dir).unwrap();
    let path = source_dir.join("Broken.ets");
    fs::write(&path, "class Broken {\n").unwrap();
    let connection = index_connection(&root);
    let root_key = root.to_string_lossy().replace('/', "\\");
    let path_key = path.to_string_lossy().replace('/', "\\");
    connection
        .execute(
            "insert into workspace_file_fingerprints (
                root_path, path, mtime_ms, size, hash,
                content_index_version, symbol_index_version, stub_parser_version,
                indexed_generation
             ) values (?1, ?2, 1, 1, 'hash', 1, 1, 1, 1)",
            params![root_key, path_key],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_stub_parse_errors (root_path, path, message, line, column)
             values (?1, ?2, 'unexpected end of file', 1, 14)",
            params![root_key, path.to_string_lossy().replace('/', "\\")],
        )
        .unwrap();

    let result = explain_workspace_index_query(&request(
        &root,
        "symbol",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "parserFailed");
    assert_eq!(result.facts[0].evidence, "unexpected end of file");
    assert_eq!(result.recommended_action.as_deref(), Some("reportBug"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_indexed_file_missing_symbol_layer_for_definition() {
    let root = unique_temp_dir("explain-symbol-layer-missing");
    let source_dir = root.join("src");
    fs::create_dir_all(&source_dir).unwrap();
    let path = source_dir.join("OnlyFingerprint.ets");
    fs::write(&path, "class OnlyFingerprint {}\n").unwrap();
    let connection = index_connection(&root);
    let root_key = root.to_string_lossy().replace('/', "\\");
    let path_key = path.to_string_lossy().replace('/', "\\");
    connection
        .execute(
            "insert into workspace_file_fingerprints (
                root_path, path, mtime_ms, size, hash,
                content_index_version, symbol_index_version, stub_parser_version,
                indexed_generation
             ) values (?1, ?2, 1, 1, 'hash', 1, 1, 1, 1)",
            params![root_key, path_key],
        )
        .unwrap();

    let result = explain_workspace_index_query(&request(
        &root,
        "definition",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "partial");
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "fileCatalog=ready" }));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "symbols=missing" }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_indexed_file_missing_content_layer_for_text_query() {
    let root = unique_temp_dir("explain-content-layer-missing");
    let source_dir = root.join("src");
    fs::create_dir_all(&source_dir).unwrap();
    let path = source_dir.join("OnlyFingerprint.ets");
    fs::write(&path, "Text('OnlyFingerprint')\n").unwrap();
    let connection = index_connection(&root);
    let root_key = root.to_string_lossy().replace('/', "\\");
    let path_key = path.to_string_lossy().replace('/', "\\");
    insert_fingerprint(&connection, &root_key, &path_key);

    let result = explain_workspace_index_query(&request(
        &root,
        "text",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "partial");
    assert_eq!(result.recommended_action.as_deref(), Some("rebuildIndex"));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "content=missing" }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_indexed_file_missing_reference_layer_for_usage_query() {
    let root = unique_temp_dir("explain-reference-layer-missing");
    let source_dir = root.join("src");
    fs::create_dir_all(&source_dir).unwrap();
    let path = source_dir.join("OnlyStub.ets");
    fs::write(&path, "class OnlyStub {}\n").unwrap();
    let connection = index_connection(&root);
    let root_key = root.to_string_lossy().replace('/', "\\");
    let path_key = path.to_string_lossy().replace('/', "\\");
    insert_fingerprint(&connection, &root_key, &path_key);
    connection
        .execute(
            "insert into workspace_stub_files (
                root_path, path, parser_version, indexed_generation,
                parse_status, error_count
             ) values (?1, ?2, 1, 1, 'ok', 0)",
            params![root_key, path_key],
        )
        .unwrap();

    let result = explain_workspace_index_query(&request(
        &root,
        "usage",
        Some(path.to_string_lossy().to_string()),
    ))
    .unwrap();

    assert_eq!(result.status, "partial");
    assert_eq!(result.recommended_action.as_deref(), Some("rebuildIndex"));
    assert!(result
        .facts
        .iter()
        .any(|fact| { fact.category == "layer" && fact.evidence == "references=missing" }));

    fs::remove_dir_all(root).unwrap();
}

fn insert_fingerprint(connection: &Connection, root_key: &str, path_key: &str) {
    connection
        .execute(
            "insert into workspace_file_fingerprints (
                root_path, path, mtime_ms, size, hash,
                content_index_version, symbol_index_version, stub_parser_version,
                indexed_generation
             ) values (?1, ?2, 1, 1, 'hash', 1, 1, 1, 1)",
            params![root_key, path_key],
        )
        .unwrap();
}
