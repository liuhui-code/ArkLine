use std::fs;

use crate::services::workspace_index_facade_service::query_facade_search_everywhere_with_readiness;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_query_command_service::query_workspace_search_everywhere_blocking;

#[test]
fn legacy_search_everywhere_command_returns_facade_items() {
    let root = create_empty_workspace("query-command-search-wrapper");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Login.ets"),
        "class LoginController {\n  submitLogin() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let facade = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::All,
        8,
    )
    .unwrap();
    let legacy = tauri::async_runtime::block_on(query_workspace_search_everywhere_blocking(
        runtime,
        root_path,
        "login".to_string(),
        8,
    ))
    .unwrap();

    assert_eq!(
        legacy
            .iter()
            .map(|candidate| candidate.id.as_str())
            .collect::<Vec<_>>(),
        facade
            .items
            .iter()
            .map(|candidate| candidate.id.as_str())
            .collect::<Vec<_>>()
    );
}
