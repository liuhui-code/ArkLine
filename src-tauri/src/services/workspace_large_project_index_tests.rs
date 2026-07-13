use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_facade_service::{
    query_facade_completions_with_readiness, query_facade_definition_candidates_with_readiness,
    query_facade_search_everywhere_with_readiness, query_facade_usages_with_readiness,
};
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_large_fixture_service::create_large_workspace_fixture;

#[test]
fn large_project_fixture_protects_core_index_queries() {
    let fixture = create_large_workspace_fixture("large-project-core-index", 96).unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let state = runtime
        .refresh_workspace_index(&fixture.root_path)
        .expect("large fixture should index");

    assert!(state.file_paths.len() >= 96);

    let file_hits = query_facade_search_everywhere_with_readiness(
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

    let class_hits = query_facade_search_everywhere_with_readiness(
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

    let symbol_hits = query_facade_search_everywhere_with_readiness(
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

    let text_hits = query_facade_search_everywhere_with_readiness(
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
    let definition = query_facade_definition_candidates_with_readiness(
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

    let usages = query_facade_usages_with_readiness(
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

    let completions = query_facade_completions_with_readiness(
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

#[test]
fn large_project_incremental_refresh_keeps_core_index_queries_fresh() {
    let fixture = create_large_workspace_fixture("large-project-incremental-index", 96).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    runtime.refresh_workspace_index(&fixture.root_path).unwrap();

    let updated_service = [
        "export class LargeTargetService {",
        "  refreshLargeTarget() { return \"LARGE_INCREMENTAL_MARKER\"; }",
        "}",
    ]
    .join("\n");
    let updated_app = [
        "import { LargeTargetService } from \"./LargeTargetService\";",
        "const service = new LargeTargetService();",
        "service.refreshLargeTarget();",
    ]
    .join("\n");
    fs::write(&fixture.service_path, updated_service).unwrap();
    fs::write(&fixture.app_path, &updated_app).unwrap();

    manager
        .schedule_changed_path_task(
            &fixture.root_path,
            &[fixture.service_path.clone(), fixture.app_path.clone()],
            WorkspaceIndexTaskPriority::ChangedFiles,
            "incremental-refresh",
        )
        .unwrap();
    manager.run_index_worker_once(&runtime, |_| {}).unwrap();

    let symbol_hits = query_facade_search_everywhere_with_readiness(
        &runtime,
        &fixture.root_path,
        "refreshLargeTarget",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();
    assert!(symbol_hits
        .items
        .iter()
        .any(|candidate| candidate.title == "refreshLargeTarget"));

    let text_hits = query_facade_search_everywhere_with_readiness(
        &runtime,
        &fixture.root_path,
        "LARGE_INCREMENTAL_MARKER",
        WorkspaceIndexQueryScope::Text,
        8,
    )
    .unwrap();
    assert!(text_hits
        .items
        .iter()
        .any(|candidate| candidate.title.contains("LARGE_INCREMENTAL_MARKER")));

    let definition = query_facade_definition_candidates_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 3,
            column: 9,
            content: Some(updated_app.clone()),
        },
        None,
        Vec::new(),
    )
    .unwrap();
    assert!(definition
        .items
        .iter()
        .any(|candidate| candidate.path == fixture.service_path && candidate.line == 2));

    let usages = query_facade_usages_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 3,
            column: 9,
            content: Some(updated_app.clone()),
        },
        8,
    )
    .unwrap();
    assert_eq!(usages.items.len(), 1);

    let completions = query_facade_completions_with_readiness(
        &runtime,
        &fixture.root_path,
        &LanguageQueryRequest {
            path: fixture.app_path.clone(),
            line: 4,
            column: 12,
            content: Some([updated_app, "service.ref".to_string()].join("\n")),
        },
        20,
    )
    .unwrap();
    assert!(completions
        .items
        .iter()
        .any(|item| item.label == "refreshLargeTarget()"));

    fs::remove_dir_all(fixture.root_path).unwrap();
}

#[test]
fn large_project_foreground_navigation_makes_active_file_ready_before_full_refresh() {
    let fixture =
        create_large_workspace_fixture("large-project-active-file-readiness", 128).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&fixture.root_path).unwrap();
    manager.run_index_worker_once(&runtime, |_| {}).unwrap();
    manager
        .schedule_changed_path_task(
            &fixture.root_path,
            &[fixture.app_path.clone()],
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            "foreground-navigation",
        )
        .unwrap();
    manager.run_index_worker_once(&runtime, |_| {}).unwrap();

    let readiness =
        get_workspace_index_file_readiness(&fixture.root_path, &fixture.app_path).unwrap();
    let statuses = manager.get_index_task_statuses(&fixture.root_path).unwrap();

    assert_eq!(readiness.file_index, "ready");
    assert_eq!(readiness.symbol_index, "ready");
    assert!(readiness.definition_available);
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.reason == "foreground-navigation"
            && status.status == "ready"
    }));
    assert!(!statuses.iter().any(|status| {
        status.reason == "background-refresh-after-open" && status.status == "running"
    }));

    fs::remove_dir_all(fixture.root_path).unwrap();
}

#[test]
fn sdk_api_indexing_does_not_block_foreground_file_readiness() {
    let fixture = create_large_workspace_fixture("sdk-does-not-block-foreground", 128).unwrap();
    let sdk_path = std::path::Path::new(&fixture.root_path).join("openharmony");
    fs::create_dir_all(sdk_path.join("ets")).unwrap();
    fs::write(
        sdk_path.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&fixture.root_path, &sdk_path.to_string_lossy(), "test-sdk")
        .unwrap();
    manager
        .schedule_changed_path_task(
            &fixture.root_path,
            &[fixture.app_path.clone()],
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            "foreground-navigation",
        )
        .unwrap();

    let results = manager.run_index_worker_once(&runtime, |_| {}).unwrap();
    let readiness =
        get_workspace_index_file_readiness(&fixture.root_path, &fixture.app_path).unwrap();

    assert!(results.iter().any(|result| {
        result.kind == "changed-paths"
            && result.reason == "foreground-navigation"
            && result.status == "ready"
    }));
    assert!(!results
        .iter()
        .any(|result| result.kind == "sdk" && result.status == "ready"));
    assert_eq!(readiness.file_index, "ready");
    assert_eq!(readiness.symbol_index, "ready");

    fs::remove_dir_all(fixture.root_path).unwrap();
}
