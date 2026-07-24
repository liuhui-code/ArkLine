use std::fs;

use rusqlite::Connection;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_event_sink_service::flush_index_events;
use crate::services::workspace_index_facade_service::{
    query_workspace_index_facade, WorkspaceIndexFacadeItem, WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn facade_routes_completion_queries_with_readiness_and_explain() {
    let root = create_empty_workspace("facade-completion");
    let app_path = root.join("Index.ets");
    fs::write(&app_path, "pri").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Completion {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.to_string_lossy().to_string(),
                line: 1,
                column: 4,
                content: Some("pri".to_string()),
            },
            limit: 20,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_explain_contains(&envelope.explain, "query:completion");
    assert_explain_contains(
        &envelope.explain,
        "used:CurrentFileIndex,WorkspaceIndex,SDKIndex,SnippetIndex",
    );
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::Completion(item)] if item.label == "private"
    ));

    flush_index_events();
    let events = load_recent_index_events(&root_path, 8).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].scope, "query");
    assert_eq!(events[0].kind, "completion");
    assert_eq!(events[0].phase, "hit");
    assert_eq!(events[0].severity, "info");
    assert!(events[0].payload_json.contains("query:completion"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_reports_partial_completion_when_current_file_catalog_is_missing() {
    let root = create_empty_workspace("facade-completion-current-file-missing");
    let app_path = root.join("Index.ets");
    fs::write(&app_path, "pri").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    clear_current_file_catalog(&root_path);

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Completion {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.to_string_lossy().to_string(),
                line: 1,
                column: 4,
                content: Some("pri".to_string()),
            },
            limit: 20,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert_explain_contains(&envelope.explain, "skipped:CurrentFileIndex:missing");
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::Completion(item), ..] if item.label == "private"
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_completion_explain_names_project_and_sdk_layers() {
    let root = create_empty_workspace("facade-completion-layer-explain");
    let app_path = root.join("Index.ets");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(&app_path, "Text").unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Completion {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.to_string_lossy().to_string(),
                line: 1,
                column: 5,
                content: Some("Text".to_string()),
            },
            limit: 20,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Completion(candidate)
            if candidate.label == "Text" && candidate.source.as_deref() == Some("sdk")
    )));
    assert!(
        envelope
            .explain
            .iter()
            .any(|line| line.starts_with("layer:projectFile:")),
        "expected projectFile layer evidence, got {:?}",
        envelope.explain
    );
    assert!(
        envelope
            .explain
            .iter()
            .any(|line| line.starts_with("layer:sdkApi:")),
        "expected sdkApi layer evidence, got {:?}",
        envelope.explain
    );
    fs::remove_dir_all(root).unwrap();
}

fn clear_current_file_catalog(root_path: &str) {
    let sqlite_path = std::path::Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(sqlite_path).unwrap();
    connection
        .execute("delete from workspace_files", [])
        .unwrap();
    connection
        .execute("delete from workspace_file_fingerprints", [])
        .unwrap();
}

fn assert_explain_contains(explain: &[String], expected: &str) {
    assert!(
        explain.iter().any(|line| line == expected),
        "expected explain to contain {expected:?}, got {explain:?}"
    );
}
