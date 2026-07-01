use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_completion_semantic_service::query_semantic_completions_with_readiness;
use crate::services::workspace_index_query_service::{
    query_definition_candidates_with_readiness, query_workspace_candidates_with_readiness,
    WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_large_fixture_service::create_large_workspace_fixture;
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

#[test]
fn large_project_fixture_protects_core_index_queries() {
    let fixture = create_large_workspace_fixture("large-project-core-index", 96).unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let state = runtime
        .refresh_workspace_index(&fixture.root_path)
        .expect("large fixture should index");

    assert!(state.file_paths.len() >= 96);

    let file_hits = query_workspace_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        "FeaturePage042",
        WorkspaceIndexQueryScope::Files,
        8,
    )
    .unwrap();
    assert_eq!(
        file_hits.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert!(file_hits
        .items
        .iter()
        .any(|candidate| candidate.title == "FeaturePage042.ets"));

    let class_hits = query_workspace_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        "LargeTargetService",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();
    assert!(class_hits
        .items
        .iter()
        .any(|candidate| candidate.title == "LargeTargetService"));

    let symbol_hits = query_workspace_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        "loadLargeTarget",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();
    assert!(symbol_hits
        .items
        .iter()
        .any(|candidate| candidate.title == "loadLargeTarget"));

    let text_hits = query_workspace_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        "LARGE_TEXT_MARKER_042",
        WorkspaceIndexQueryScope::Text,
        8,
    )
    .unwrap();
    assert!(text_hits
        .items
        .iter()
        .any(|candidate| candidate.title.contains("LARGE_TEXT_MARKER_042")));

    let app_content = fs::read_to_string(&fixture.app_path).unwrap();
    let definition = query_definition_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 3,
            column: 9,
            content: Some(app_content.clone()),
        },
        None,
        Vec::new(),
    )
    .unwrap();
    assert!(definition
        .items
        .iter()
        .any(|candidate| candidate.path == fixture.service_path && candidate.line == 2));

    let usages = query_usages_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 3,
            column: 9,
            content: Some(app_content.clone()),
        },
        8,
    )
    .unwrap();
    assert_eq!(usages.items.len(), 1);

    let completions = query_semantic_completions_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 4,
            column: 6,
            content: Some([app_content, "Large".to_string()].join("\n")),
        },
        20,
    )
    .unwrap();
    assert!(completions
        .items
        .iter()
        .any(|item| item.label == "LargeTargetService"));

    fs::remove_dir_all(fixture.root_path).unwrap();
}
