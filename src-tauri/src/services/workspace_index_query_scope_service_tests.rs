use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_index_query_service::{
    query_workspace_candidates, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn query_facade_filters_candidates_by_ide_scope() {
    let root = unique_temp_dir("workspace-query-facade-scope");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let sdk_dir = root.join("sdk").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&sdk_dir).unwrap();
    fs::write(
        source_dir.join("LoginPage.ets"),
        "class LoginController {\n  loginAction() {}\n}\n",
    )
    .unwrap();
    fs::write(
        sdk_dir.join("login-api.d.ts"),
        "declare class LoginApi {\n  loginAction(): void\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_dir.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_path, "test-sdk").unwrap();

    let files = query_workspace_candidates(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::Files,
        8,
    )
    .unwrap();
    let classes = query_workspace_candidates(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();
    let symbols = query_workspace_candidates(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();
    let apis = query_workspace_candidates(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::Apis,
        8,
    )
    .unwrap();
    let all = query_workspace_candidates(
        &runtime,
        &root_path,
        "login",
        WorkspaceIndexQueryScope::All,
        8,
    )
    .unwrap();

    assert!(files.iter().all(|candidate| candidate.source == "file"));
    assert!(classes.iter().all(|candidate| candidate.source == "class"));
    assert!(symbols.iter().all(|candidate| candidate.source == "symbol"));
    assert!(apis.iter().all(|candidate| candidate.source == "api"));
    assert!(all.iter().any(|candidate| candidate.source == "file"));
    assert!(all.iter().any(|candidate| candidate.source == "class"));
    assert!(all.iter().any(|candidate| candidate.source == "symbol"));
    assert!(all.iter().any(|candidate| candidate.source == "api"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_symbol_scope_is_not_truncated_by_class_matches() {
    let root = unique_temp_dir("workspace-query-facade-symbol-scope");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let class_declarations = (0..30)
        .map(|index| format!("class TargetClass{index:02} {{}}\n"))
        .collect::<String>();
    fs::write(
        source_dir.join("Symbols.ets"),
        format!("{class_declarations}class Host {{\n  veryTargetAction() {{}}\n}}\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let symbols = query_workspace_candidates(
        &runtime,
        &root_path,
        "target",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert!(symbols.iter().any(|candidate| {
        candidate.source == "symbol" && candidate.title == "veryTargetAction"
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_reads_file_and_symbol_scopes_from_restored_sqlite_index() {
    let root = unique_temp_dir("workspace-query-facade-sqlite-restored");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("RestoredLogin.ets"),
        "class RestoredLoginController {\n  restoredLoginAction() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    sqlite_connection(&root)
        .execute("delete from workspace_symbols", [])
        .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let files = query_workspace_candidates(
        &runtime,
        &root_path,
        "restored",
        WorkspaceIndexQueryScope::Files,
        8,
    )
    .unwrap();
    let classes = query_workspace_candidates(
        &runtime,
        &root_path,
        "restored",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();
    let symbols = query_workspace_candidates(
        &runtime,
        &root_path,
        "restored",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();
    let all = query_workspace_candidates(
        &runtime,
        &root_path,
        "restored",
        WorkspaceIndexQueryScope::All,
        8,
    )
    .unwrap();

    assert!(files
        .iter()
        .any(|candidate| candidate.source == "file" && candidate.title == "RestoredLogin.ets"));
    assert!(classes.iter().any(
        |candidate| candidate.source == "class" && candidate.title == "RestoredLoginController"
    ));
    assert!(symbols
        .iter()
        .any(|candidate| candidate.source == "symbol" && candidate.title == "restoredLoginAction"));
    assert!(all.iter().any(|candidate| candidate.source == "file"));
    assert!(all.iter().any(|candidate| candidate.source == "class"));
    assert!(all.iter().any(|candidate| candidate.source == "symbol"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_reads_class_and_symbol_scopes_from_stub_declarations() {
    let root = unique_temp_dir("workspace-query-facade-stubs");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("StubQuery.ets"),
        "struct StubQueryPage {\n  stubQueryAction() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    sqlite_connection(&root)
        .execute("delete from workspace_symbols", [])
        .unwrap();
    sqlite_connection(&root)
        .execute("delete from workspace_symbol_entities", [])
        .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let classes = query_workspace_candidates(
        &runtime,
        &root_path,
        "stubquery",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();
    let symbols = query_workspace_candidates(
        &runtime,
        &root_path,
        "stubquery",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert!(classes
        .iter()
        .any(|candidate| candidate.source == "class" && candidate.title == "StubQueryPage"));
    assert!(symbols
        .iter()
        .any(|candidate| candidate.source == "symbol" && candidate.title == "stubQueryAction"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_facade_falls_back_to_symbol_entities_when_stub_rows_are_missing() {
    let root = unique_temp_dir("workspace-query-facade-entity");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("EntityQuery.ets"),
        "class EntityQueryController {\n  runEntityQuery() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    sqlite_connection(&root)
        .execute("delete from workspace_stub_declarations", [])
        .unwrap();
    sqlite_connection(&root)
        .execute("delete from workspace_stub_files", [])
        .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let symbols = query_workspace_candidates(
        &runtime,
        &root_path,
        "entityquery",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();
    let method = symbols
        .iter()
        .find(|candidate| candidate.title == "runEntityQuery")
        .expect("method entity should be queryable");

    assert_eq!(method.source, "symbol");
    assert!(method.subtitle.starts_with("EntityQueryController"));

    fs::remove_dir_all(root).unwrap();
}

fn sqlite_connection(root: &std::path::Path) -> Connection {
    Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
}
