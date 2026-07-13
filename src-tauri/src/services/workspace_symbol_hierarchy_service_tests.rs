use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_symbol_hierarchy_service::{
    query_call_hierarchy, query_type_hierarchy,
};

#[test]
fn call_hierarchy_reports_incoming_and_outgoing_references() {
    let root = create_empty_workspace("symbol-hierarchy-call");
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("Service.ets");
    fs::write(
        &service_path,
        [
            "export function audit() {}",
            "export function load() {",
            "  audit();",
            "}",
            "export function run() {",
            "  load();",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let hierarchy = query_call_hierarchy(
        &root_path,
        &LanguageQueryRequest {
            path: service_path.to_string_lossy().to_string(),
            line: 2,
            column: 17,
            content: Some(fs::read_to_string(&service_path).unwrap()),
        },
        20,
    )
    .unwrap()
    .expect("call hierarchy should resolve load");

    assert_eq!(hierarchy.target.name, "load");
    assert!(hierarchy
        .incoming
        .iter()
        .any(|edge| edge.name == "load" && edge.line == 6));
    assert!(hierarchy
        .outgoing
        .iter()
        .any(|edge| edge.name == "audit" && edge.line == 3));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn type_hierarchy_reports_extends_relationships() {
    let root = create_empty_workspace("symbol-hierarchy-type");
    let source_dir = create_workspace_source_dir(&root);
    let types_path = source_dir.join("Types.ets");
    fs::write(
        &types_path,
        [
            "export class Base {}",
            "export class Child extends Base {}",
            "export class GrandChild extends Child {}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let hierarchy = query_type_hierarchy(
        &root_path,
        &LanguageQueryRequest {
            path: types_path.to_string_lossy().to_string(),
            line: 2,
            column: 14,
            content: Some(fs::read_to_string(&types_path).unwrap()),
        },
        20,
    )
    .unwrap()
    .expect("type hierarchy should resolve Child");

    assert_eq!(hierarchy.target.name, "Child");
    assert_eq!(hierarchy.supertypes[0].name, "Base");
    assert_eq!(hierarchy.subtypes[0].name, "GrandChild");
    fs::remove_dir_all(root).unwrap();
}
