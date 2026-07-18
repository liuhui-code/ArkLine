use std::fs;

use crate::services::workspace_index_facade_service::{
    query_facade_file_symbols_with_readiness, query_facade_search_everywhere_with_readiness,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_query_broker_service::WorkspaceQueryBrokerRuntime;
use crate::services::workspace_query_command_service::{
    query_workspace_candidates_brokered_blocking, query_workspace_candidates_facade_blocking,
    query_workspace_file_symbols_facade_blocking,
    query_workspace_search_everywhere_compat_blocking,
};
use crate::services::workspace_search_ranking_service::WorkspaceSearchRankingContext;
use crate::services::workspace_search_session_service::WorkspaceSearchSessionRuntime;

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
    let legacy = tauri::async_runtime::block_on(query_workspace_search_everywhere_compat_blocking(
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

#[test]
fn candidate_command_returns_facade_envelope() {
    let root = create_empty_workspace("query-command-candidates-wrapper");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Profile.ets"),
        "class ProfileController {\n  loadProfile() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let facade = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "profile",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();
    let command = tauri::async_runtime::block_on(query_workspace_candidates_facade_blocking(
        runtime,
        root_path,
        "profile".to_string(),
        WorkspaceIndexQueryScope::Classes,
        8,
        None,
        WorkspaceSearchRankingContext::default(),
    ))
    .unwrap();

    assert_eq!(command.items, facade.items);
    assert_eq!(command.readiness.state, facade.readiness.state);
    assert_eq!(command.explain, facade.explain);
}

#[test]
fn brokered_candidate_command_rejects_a_superseded_generation() {
    let sessions = WorkspaceSearchSessionRuntime::default();
    let broker = WorkspaceQueryBrokerRuntime::new(sessions);
    broker
        .begin("/workspace", "searchEverywhere", Some(2), 1_000)
        .unwrap();

    let error = tauri::async_runtime::block_on(query_workspace_candidates_brokered_blocking(
        WorkspaceIndexRuntime::default(),
        broker,
        "/workspace".to_string(),
        "Entry".to_string(),
        WorkspaceIndexQueryScope::All,
        8,
        None,
        WorkspaceSearchRankingContext::default(),
        Some(1),
        Some(1_000),
    ))
    .unwrap_err();

    assert_eq!(error, "Workspace query superseded");
}

#[test]
fn file_symbols_command_returns_facade_envelope() {
    let root = create_empty_workspace("query-command-file-symbols-wrapper");
    let source_dir = create_workspace_source_dir(&root);
    let file_path = source_dir.join("Entry.ets");
    fs::write(
        &file_path,
        "class EntryAbility {\n  aboutToAppear() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let file_path = file_path.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let facade =
        query_facade_file_symbols_with_readiness(&runtime, &root_path, &file_path, "", 8).unwrap();
    let command = tauri::async_runtime::block_on(query_workspace_file_symbols_facade_blocking(
        runtime,
        root_path,
        file_path,
        "".to_string(),
        8,
        None,
    ))
    .unwrap();

    assert_eq!(command.items, facade.items);
    assert_eq!(command.readiness.state, facade.readiness.state);
    assert_eq!(command.explain, facade.explain);
}
