use std::fs;

use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_facade_service::{
    query_facade_text_search_result, query_workspace_index_facade, WorkspaceIndexFacadeEnvelope,
    WorkspaceIndexFacadeItem, WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn facade_routes_search_everywhere_queries_with_readiness_and_explain() {
    let root = create_empty_workspace("facade-search-everywhere");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("LoginPage.ets"),
        "class LoginController {\n  submitLogin() {}\n}\n",
    )
    .unwrap();
    let sdk_dir = root.join("sdk").join("ets");
    fs::create_dir_all(&sdk_dir).unwrap();
    fs::write(
        sdk_dir.join("login-api.d.ts"),
        "declare class LoginApi {\n  loginAction(): void\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_dir.to_string_lossy(), "test-sdk").unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "login".to_string(),
            scope: WorkspaceIndexQueryScope::All,
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(envelope.confidence.as_deref(), Some("indexed"));
    assert_explain_contains(&envelope.explain, "query:searchEverywhere");
    assert_explain_contains(
        &envelope.explain,
        "used:FileIndex,WorkspaceIndex,SDKIndex,TextIndex",
    );
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.source == "file" && candidate.title == "LoginPage.ets"
    )));
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.source == "class" && candidate.title == "LoginController"
    )));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_scoped_search_queries() {
    let root = create_empty_workspace("facade-scoped-search");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("LoginPage.ets"),
        "class LoginController {\n  submitLogin() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let files = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "login".to_string(),
            scope: WorkspaceIndexQueryScope::Files,
            limit: 8,
        },
    )
    .unwrap();
    let classes = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "login".to_string(),
            scope: WorkspaceIndexQueryScope::Classes,
            limit: 8,
        },
    )
    .unwrap();
    let symbols = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "login".to_string(),
            scope: WorkspaceIndexQueryScope::Symbols,
            limit: 8,
        },
    )
    .unwrap();
    let apis = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "login".to_string(),
            scope: WorkspaceIndexQueryScope::Apis,
            limit: 8,
        },
    )
    .unwrap();

    assert!(search_sources(&files)
        .iter()
        .all(|source| *source == "file"));
    assert!(search_sources(&classes)
        .iter()
        .all(|source| *source == "class"));
    assert!(search_sources(&symbols)
        .iter()
        .all(|source| *source == "symbol"));
    assert!(search_sources(&apis).iter().all(|source| *source == "api"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_text_search_scope_queries() {
    let root = create_empty_workspace("facade-text-search");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"QueryFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "queryfacadetarget".to_string(),
            scope: WorkspaceIndexQueryScope::Text,
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_explain_contains(&envelope.explain, "query:searchEverywhere");
    assert_explain_contains(
        &envelope.explain,
        "used:FileIndex,WorkspaceIndex,SDKIndex,TextIndex",
    );
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.source == "text"
                && candidate.title.contains("QueryFacadeTarget")
                && candidate.line == Some(2)
    )));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_global_text_search_result_and_preserves_regex_fallback() {
    let root = create_empty_workspace("facade-global-text-search");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"GlobalFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let plain = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "globalfacadetarget".to_string(),
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();
    let regex = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "/Text\\(\".+\"\\)/".to_string(),
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();

    assert_eq!(plain.matches.len(), 1);
    assert_eq!(regex.matches.len(), 1);
    assert!(plain.matches[0].summary.contains("GlobalFacadeTarget"));
    let events = load_recent_index_events(&root_path, 8).unwrap();
    assert!(events.iter().any(|event| {
        event.scope == "query"
            && event.kind == "textSearch"
            && event.phase == "hit"
            && event.payload_json.contains("query:textSearch")
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_text_search_requests_with_readiness_and_explain() {
    let root = create_empty_workspace("facade-text-search-request");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "Text(\"FacadeRequestTarget\")\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::TextSearch {
            request: WorkspaceTextSearchRequest {
                root_path: root_path.clone(),
                query: "facaderequesttarget".to_string(),
                options: WorkspaceTextSearchOptions {
                    case_sensitive: false,
                    whole_word: false,
                },
                limit: 8,
                context_lines: 0,
            },
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_explain_contains(&envelope.explain, "query:textSearch");
    assert_explain_contains(&envelope.explain, "used:TextIndex");
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)] if result.matches[0].summary.contains("FacadeRequestTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

fn search_sources(envelope: &WorkspaceIndexFacadeEnvelope) -> Vec<&str> {
    envelope
        .items
        .iter()
        .filter_map(|item| match item {
            WorkspaceIndexFacadeItem::Search(candidate) => Some(candidate.source.as_str()),
            _ => None,
        })
        .collect()
}

fn assert_explain_contains(explain: &[String], expected: &str) {
    assert!(
        explain.iter().any(|line| line == expected),
        "expected explain to contain {expected:?}, got {explain:?}"
    );
}
