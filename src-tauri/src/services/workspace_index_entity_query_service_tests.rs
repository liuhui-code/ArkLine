use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_index_entity_query_service::{
    query_workspace_entities, query_workspace_file_symbols, WorkspaceEntityQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn queries_all_symbols_for_one_file_in_source_order() {
    let root = unique_temp_dir("workspace-file-symbols-outline");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let file_path = source_dir.join("Outline.ets");
    fs::write(
        &file_path,
        "class OutlineController {\n  firstAction() {}\n  secondAction() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let symbols =
        query_workspace_file_symbols(&root_path, &file_path.to_string_lossy(), "", 20).unwrap();

    assert_eq!(
        symbols
            .iter()
            .map(|symbol| symbol.title.as_str())
            .collect::<Vec<_>>(),
        vec!["OutlineController", "firstAction", "secondAction"]
    );
    let first_action = symbols
        .iter()
        .find(|symbol| symbol.title == "firstAction")
        .expect("method should be returned");
    assert_eq!(first_action.container.as_deref(), Some("OutlineController"));
    assert_eq!(first_action.signature.as_deref(), Some("firstAction()"));
    assert_eq!(first_action.visibility.as_deref(), None);
    assert!(symbols.windows(2).all(|pair| pair[0].line <= pair[1].line));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn filters_file_symbols_without_leaking_other_files() {
    let root = unique_temp_dir("workspace-file-symbols-filter");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let target_file = source_dir.join("Target.ets");
    let other_file = source_dir.join("Other.ets");
    fs::write(
        &target_file,
        "class TargetController {\n  saveTarget() {}\n  cancelTarget() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &other_file,
        "class OtherController {\n  saveTarget() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let symbols =
        query_workspace_file_symbols(&root_path, &target_file.to_string_lossy(), "save", 20)
            .unwrap();

    assert_eq!(symbols.len(), 1);
    assert_eq!(symbols[0].title, "saveTarget");
    assert_eq!(
        symbols[0].path.as_deref(),
        Some(target_file.to_string_lossy().replace('/', "\\").as_str())
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn search_scopes_prefer_stub_declarations_without_legacy_symbols() {
    let root = unique_temp_dir("workspace-stub-symbol-scopes");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("StubOnly.ets"),
        "struct StubOnlyPage {\n  @Builder\n  stubOnlyHeader() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let sqlite_path = sqlite_path(&root);
    Connection::open(&sqlite_path)
        .unwrap()
        .execute("delete from workspace_symbols", [])
        .unwrap();
    Connection::open(&sqlite_path)
        .unwrap()
        .execute("delete from workspace_symbol_entities", [])
        .unwrap();

    let classes = query_workspace_entities(
        &root_path,
        "stubonly",
        WorkspaceEntityQueryScope::Classes,
        8,
    )
    .unwrap();
    let symbols = query_workspace_entities(
        &root_path,
        "stubonly",
        WorkspaceEntityQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert!(classes.iter().any(|candidate| {
        candidate.source == "class"
            && candidate.kind == "struct"
            && candidate.title == "StubOnlyPage"
    }));
    let method = symbols
        .iter()
        .find(|candidate| candidate.title == "stubOnlyHeader")
        .expect("stub method should be queryable");
    assert_eq!(method.source, "symbol");
    assert!(method.subtitle.contains("StubOnlyPage"));
    assert!(method
        .path
        .as_deref()
        .is_some_and(|path| path.ends_with("StubOnly.ets")));
    assert!(method.line.is_some_and(|line| line > 0));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn file_symbols_use_stub_source_order_without_legacy_symbols() {
    let root = unique_temp_dir("workspace-stub-file-symbols");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let file_path = source_dir.join("Outline.ets");
    fs::write(
        &file_path,
        "struct OutlinePage {\n  firstHeader() {}\n  secondHeader() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let sqlite_path = sqlite_path(&root);
    Connection::open(&sqlite_path)
        .unwrap()
        .execute("delete from workspace_symbols", [])
        .unwrap();
    Connection::open(&sqlite_path)
        .unwrap()
        .execute("delete from workspace_symbol_entities", [])
        .unwrap();

    let symbols =
        query_workspace_file_symbols(&root_path, &file_path.to_string_lossy(), "", 20).unwrap();

    assert_eq!(
        symbols
            .iter()
            .map(|symbol| symbol.title.as_str())
            .collect::<Vec<_>>(),
        vec!["OutlinePage", "firstHeader", "secondHeader"]
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn falls_back_to_symbol_entities_when_stub_rows_are_missing() {
    let root = unique_temp_dir("workspace-stub-fallback-entities");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Fallback.ets"),
        "class FallbackController {\n  fallbackAction() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let sqlite_path = sqlite_path(&root);
    for table in [
        "workspace_stub_declarations",
        "workspace_stub_files",
        "workspace_stub_imports",
        "workspace_stub_exports",
        "workspace_stub_parse_errors",
    ] {
        Connection::open(&sqlite_path)
            .unwrap()
            .execute(&format!("delete from {table}"), [])
            .unwrap();
    }

    let symbols = query_workspace_entities(
        &root_path,
        "fallback",
        WorkspaceEntityQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert!(symbols
        .iter()
        .any(|candidate| { candidate.source == "symbol" && candidate.title == "fallbackAction" }));

    fs::remove_dir_all(root).unwrap();
}

fn sqlite_path(root: &PathBuf) -> PathBuf {
    root.join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}
