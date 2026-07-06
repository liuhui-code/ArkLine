use std::fs;

use rusqlite::Connection;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceIndexState, WorkspaceIndexStatus,
};
use crate::services::workspace_index_facade_service::{
    query_facade_definition_candidates_with_readiness, query_workspace_index_facade,
    WorkspaceIndexFacadeItem, WorkspaceIndexFacadeKind, WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

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
    assert_explain_contains(&envelope.explain, "query:definition");
    assert_explain_contains(
        &envelope.explain,
        "used:FileIndex,WorkspaceIndex,SDKIndex,ReferenceIndex",
    );
    assert_explain_contains(&envelope.explain, "resultCount:1");
    assert!(matches!(
        envelope.items.first(),
        Some(WorkspaceIndexFacadeItem::Definition(candidate))
            if candidate.preview == "load()"
    ));
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
fn facade_query_envelope_exposes_explain_for_command_wrappers() {
    let (root_path, app_path, _service_path) = create_member_workspace("facade-envelope-explain");
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_facade_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.clone(),
            line: 3,
            column: 9,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_explain_contains(&envelope.explain, "query:definition");
    assert_explain_contains(&envelope.explain, "resultCount:1");
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
    assert_explain_contains(&envelope.explain, "query:usages");
    assert_explain_contains(&envelope.explain, "used:ReferenceIndex,WorkspaceIndex");
    assert_explain_contains(&envelope.explain, "resultCount:1");
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::Usage(usage)] if usage.preview == "service.load();"
    ));
    fs::remove_dir_all(root_path).unwrap();
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
    assert_explain_contains(&envelope.explain, "query:fileSymbols");
    assert_explain_contains(&envelope.explain, "used:FileIndex,SymbolIndex");
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.title == "ProfileController"
    )));
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
    assert_explain_contains(&envelope.explain, "query:definition");
    assert_explain_contains(&envelope.explain, "skipped:definitionResultCommit");
    assert!(envelope
        .explain
        .iter()
        .any(|line| line.starts_with("reason:Served generation 7")));
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
fn facade_reports_partial_definition_when_symbol_layer_is_missing() {
    let (root_path, app_path, _service_path) =
        create_member_workspace("facade-definition-symbol-missing");
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    clear_tables(
        &root_path,
        &["workspace_symbol_entities", "workspace_symbols"],
    );

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
        WorkspaceIndexReadinessState::Partial
    );
    assert_explain_contains(&envelope.explain, "skipped:SymbolIndex:missing");
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
fn facade_reports_partial_usages_when_reference_layer_is_missing() {
    let (root_path, app_path, _service_path) =
        create_member_workspace("facade-usages-reference-missing");
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    clear_tables(&root_path, &["workspace_symbol_references"]);

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
        WorkspaceIndexReadinessState::Partial
    );
    assert_explain_contains(&envelope.explain, "skipped:ReferenceIndex:missing");
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

fn clear_tables(root_path: &str, tables: &[&str]) {
    let sqlite_path = std::path::Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(sqlite_path).unwrap();
    for table in tables {
        connection
            .execute(&format!("delete from {table}"), [])
            .unwrap();
    }
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

fn assert_explain_contains(explain: &[String], expected: &str) {
    assert!(
        explain.iter().any(|line| line == expected),
        "expected explain to contain {expected:?}, got {explain:?}"
    );
}
