use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::query_definition_candidates_with_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_worker_sidecar_fallback_tests::unique_temp_dir;

#[test]
fn completed_workspace_open_does_not_remain_pending() {
    let root = unique_temp_dir("workspace-index-manager-open-ready");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let service_path = source_dir.join("UserService.ets");
    let home_path = source_dir.join("Home.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &home_path,
        "import { UserService } from \"./UserService\"\nconst service = new UserService()\nconst marker = \"IndexedReady\"\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let mut completed_results = Vec::new();
    for _ in 0..16 {
        let results = manager.drain_index_task_results(&index_runtime).unwrap();
        if results.is_empty() {
            break;
        }
        completed_results.extend(results);
    }

    let state = index_runtime.get_index_state(&root_path).unwrap();
    let pressure = manager.get_queue_pressure(&root_path).unwrap();
    let matches = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "IndexedReady".to_string(),
        generation: None,
        cursor: None,
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 0,
    })
    .unwrap();
    let definition = query_definition_candidates_with_readiness(
        &index_runtime,
        &root_path,
        &LanguageQueryRequest {
            path: home_path.to_string_lossy().to_string(),
            line: 2,
            column: 22,
            content: Some(fs::read_to_string(&home_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(pressure.workspace_pending_task_count, 0);
    assert_eq!(matches.matches.len(), 1);
    assert_eq!(
        definition.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert!(definition
        .items
        .iter()
        .any(|candidate| candidate.path == service_path.to_string_lossy()));
    assert_eq!(state.status.to_string(), "ready");
    assert_eq!(state.partial_reason, None);
    assert!(completed_results.iter().any(|result| {
        result.status == "ready"
            && result.message.as_deref() == Some("Deep refresh catalog complete")
    }));

    let restored_state = WorkspaceIndexRuntime::default()
        .get_index_state(&root_path)
        .unwrap();
    assert_eq!(restored_state.status.to_string(), "ready");
    assert_eq!(restored_state.partial_reason, None);

    fs::remove_dir_all(root).unwrap();
}
