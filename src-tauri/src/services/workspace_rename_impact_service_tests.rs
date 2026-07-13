use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_rename_impact_service::query_rename_impact;

#[test]
fn rename_impact_resolves_import_alias_by_symbol_identity() {
    let root = create_empty_workspace("rename-impact-alias");
    let source_dir = create_workspace_source_dir(&root);
    let foo_path = source_dir.join("Foo.ets");
    let app_path = source_dir.join("App.ets");
    fs::write(&foo_path, "export class Foo {}\n").unwrap();
    fs::write(
        &app_path,
        [
            "import { Foo as Bar } from \"./Foo\";",
            "const first = new Bar();",
            "const second = Bar;",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let impact = query_rename_impact(
        &root_path,
        &LanguageQueryRequest {
            path: foo_path.to_string_lossy().to_string(),
            line: 1,
            column: 14,
            content: Some(fs::read_to_string(&foo_path).unwrap()),
        },
        20,
    )
    .unwrap()
    .expect("rename impact should resolve declaration symbol");

    assert_eq!(impact.current_name, "Foo");
    assert!(impact.symbol_id.contains(":class:Foo:"));
    assert_eq!(impact.declaration.as_ref().unwrap().name, "Foo");
    let references = impact
        .references
        .iter()
        .map(|item| {
            (
                item.name.as_str(),
                item.line,
                item.column,
                item.preview.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        references,
        vec![
            ("Bar", 2, 19, "const first = new Bar();"),
            ("Bar", 3, 16, "const second = Bar;"),
        ]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rename_impact_returns_none_when_no_symbol_is_available() {
    let root = create_empty_workspace("rename-impact-none");
    let source_dir = create_workspace_source_dir(&root);
    let app_path = source_dir.join("App.ets");
    fs::write(&app_path, "const value = 1;\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let impact = query_rename_impact(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 1,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        20,
    )
    .unwrap();

    assert_eq!(impact, None);
    fs::remove_dir_all(root).unwrap();
}
