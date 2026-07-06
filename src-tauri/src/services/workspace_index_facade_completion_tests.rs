use std::fs;

use rusqlite::Connection;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_facade_service::{
    query_workspace_index_facade, WorkspaceIndexFacadeItem, WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;

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
