use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_facade_service::{
    query_facade_text_search_result, query_workspace_index_facade, WorkspaceIndexFacadeItem,
    WorkspaceIndexFacadeKind, WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn facade_routes_definition_queries_with_readiness_and_explain() {
    let (root_path, app_path, _service_path) = create_member_workspace("facade-definition");
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Definition {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.clone(),
                line: 3,
                column: 9,
                content: Some(fs::read_to_string(&app_path).unwrap()),
            },
            semantic_target: None,
            semantic_candidates: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(envelope.confidence.as_deref(), Some("memberResolved"));
    assert_eq!(envelope.explain, vec!["facade:definition".to_string()]);
    assert!(matches!(
        envelope.items.first(),
        Some(WorkspaceIndexFacadeItem::Definition(candidate))
            if candidate.preview == "load()"
    ));
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
fn facade_routes_usage_queries_with_readiness_and_explain() {
    let (root_path, app_path, _service_path) = create_member_workspace("facade-usages");
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Usages {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.clone(),
                line: 3,
                column: 9,
                content: Some(fs::read_to_string(&app_path).unwrap()),
            },
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(envelope.confidence.as_deref(), Some("memberResolved"));
    assert_eq!(envelope.explain, vec!["facade:usages".to_string()]);
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::Usage(usage)] if usage.preview == "service.load();"
    ));
    fs::remove_dir_all(root_path).unwrap();
}

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
    assert_eq!(
        envelope.explain,
        vec!["facade:searchEverywhere".to_string()]
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
    assert_eq!(
        envelope.explain,
        vec!["facade:searchEverywhere".to_string()]
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
fn facade_routes_file_symbol_queries_with_readiness_and_explain() {
    let root = create_empty_workspace("facade-file-symbols");
    let source_dir = create_workspace_source_dir(&root);
    let file_path = source_dir.join("Profile.ets");
    fs::write(
        &file_path,
        "class ProfileController {\n  saveProfile() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::FileSymbols {
            root_path: root_path.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            query: "profile".to_string(),
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(envelope.confidence.as_deref(), Some("indexed"));
    assert_eq!(envelope.explain, vec!["facade:fileSymbols".to_string()]);
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.title == "ProfileController"
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
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_preserves_stale_readiness_for_definition_queries() {
    let (root_path, app_path, _service_path) = create_member_workspace("facade-stale");
    let runtime = WorkspaceIndexRuntime::default();
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.clone()),
            file_paths: vec![app_path.clone()],
            symbols: Vec::new(),
            indexed_at: Some(7),
            partial_reason: None,
        },
    )
    .unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Definition {
            root_path: root_path.clone(),
            request: LanguageQueryRequest {
                path: app_path.clone(),
                line: 1,
                column: 7,
                content: Some(fs::read_to_string(&app_path).unwrap()),
            },
            semantic_target: None,
            semantic_candidates: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Stale
    );
    assert!(envelope.readiness.retryable);
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
fn facade_rejects_unsupported_query_kinds() {
    let root = create_empty_workspace("facade-unsupported");
    let runtime = WorkspaceIndexRuntime::default();
    let error = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::Unsupported {
            root_path: root.to_string_lossy().to_string(),
            kind: WorkspaceIndexFacadeKind::Completion,
        },
    )
    .unwrap_err();

    assert_eq!(
        error,
        "Unsupported workspace index facade query: completion"
    );
    fs::remove_dir_all(root).unwrap();
}

fn create_member_workspace(name: &str) -> (String, String, String) {
    let root = create_empty_workspace(name);
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    (
        root.to_string_lossy().to_string(),
        app_path.to_string_lossy().to_string(),
        service_path.to_string_lossy().to_string(),
    )
}

fn search_sources(
    envelope: &crate::services::workspace_index_facade_service::WorkspaceIndexFacadeEnvelope,
) -> Vec<&str> {
    envelope
        .items
        .iter()
        .filter_map(|item| match item {
            WorkspaceIndexFacadeItem::Search(candidate) => Some(candidate.source.as_str()),
            _ => None,
        })
        .collect()
}
