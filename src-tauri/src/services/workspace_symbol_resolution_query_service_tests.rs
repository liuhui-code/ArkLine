use std::fs;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_symbol_resolution_query_service::{
    query_resolved_symbols_by_name, query_resolved_symbols_by_path,
    query_resolved_symbols_by_target,
};

#[test]
fn queries_resolved_symbols_by_name_across_project_import_and_export_sources() {
    let root = resolved_symbol_workspace("symbol-resolution-query-name");
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let project = query_resolved_symbols_by_name(&root_path, "Foo", 8).unwrap();
    let import_alias = query_resolved_symbols_by_name(&root_path, "Bar", 8).unwrap();
    let export_alias = query_resolved_symbols_by_name(&root_path, "PublicFoo", 8).unwrap();

    assert_eq!(project[0].source, "project");
    assert_eq!(import_alias[0].source, "import");
    assert_eq!(export_alias[0].source, "export");
    assert!(import_alias[0]
        .target_symbol_id
        .as_deref()
        .unwrap()
        .contains(":class:Foo:"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queries_alias_symbols_by_target_symbol_id() {
    let root = resolved_symbol_workspace("symbol-resolution-query-target");
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let project = query_resolved_symbols_by_name(&root_path, "Foo", 8).unwrap();
    let aliases = query_resolved_symbols_by_target(&root_path, &project[0].symbol_id, 8).unwrap();
    let alias_names = aliases
        .iter()
        .map(|symbol| symbol.name.as_str())
        .collect::<Vec<_>>();

    assert!(alias_names.contains(&"Bar"));
    assert!(alias_names.contains(&"PublicFoo"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queries_resolved_symbols_by_path_in_source_order() {
    let root = resolved_symbol_workspace("symbol-resolution-query-path");
    let root_path = root.to_string_lossy().to_string();
    let index_path = root
        .join("entry")
        .join("src")
        .join("main")
        .join("ets")
        .join("Index.ets")
        .to_string_lossy()
        .to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let symbols = query_resolved_symbols_by_path(&root_path, &index_path, 8).unwrap();
    let names = symbols
        .iter()
        .map(|symbol| symbol.name.as_str())
        .collect::<Vec<_>>();

    assert_eq!(names, vec!["Bar", "PublicFoo"]);
    fs::remove_dir_all(root).unwrap();
}

fn resolved_symbol_workspace(name: &str) -> std::path::PathBuf {
    let root = create_empty_workspace(name);
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Foo as Bar } from \"./Foo\";",
            "export { Foo as PublicFoo } from \"./Foo\";",
            "let value = Bar;",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    root
}
