use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn workspace_refresh_resolves_project_member_access_from_instanceof_guard() {
    let root = create_empty_workspace("reference-index-project-member-instanceof-guard");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "let service = createService();",
            "if (service instanceof UserService) {",
            "  service.load();",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "load");
    assert!(rows[0].2.contains(":method:UserService.load:"));
    assert_eq!(rows[0].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_keeps_instanceof_guard_inside_block_scope() {
    let root = create_empty_workspace("reference-index-project-member-instanceof-scope");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "let service = createService();",
            "if (service instanceof UserService) {",
            "  service.load();",
            "}",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 2);
    assert!(rows[0].2.contains(":method:UserService.load:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].2, "");
    assert_eq!(rows[1].3, "unresolvedLikely");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_instanceof_else_if_branch_guards() {
    let root = create_empty_workspace("reference-index-project-member-instanceof-else-if");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("BackupService.ets"),
        "export class BackupService {\n  save() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "import { BackupService } from \"./BackupService\";",
            "let service = createService();",
            "if (service instanceof UserService) {",
            "  service.load();",
            "} else if (service instanceof BackupService) {",
            "  service.save();",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].1, "load");
    assert!(rows[0].2.contains(":method:UserService.load:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].1, "save");
    assert!(rows[1].2.contains(":method:BackupService.save:"));
    assert_eq!(rows[1].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_member_access_after_matching_branch_assignments() {
    let root = create_empty_workspace("reference-index-project-member-branch-assignment-join");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "let service;",
            "if (enabled) {",
            "  service = new UserService();",
            "} else {",
            "  service = new UserService();",
            "}",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "load");
    assert!(rows[0].2.contains(":method:UserService.load:"));
    assert_eq!(rows[0].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_does_not_leak_single_branch_assignment_after_block() {
    let root = create_empty_workspace("reference-index-project-member-single-branch-assignment");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "let service;",
            "if (enabled) {",
            "  service = new UserService();",
            "}",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "load");
    assert_eq!(rows[0].2, "");
    assert_eq!(rows[0].3, "unresolvedLikely");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_does_not_resolve_after_divergent_branch_assignments() {
    let root = create_empty_workspace("reference-index-project-member-divergent-branch-assignment");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("BackupService.ets"),
        "export class BackupService {\n  save() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "import { BackupService } from \"./BackupService\";",
            "let service;",
            "if (enabled) {",
            "  service = new UserService();",
            "} else {",
            "  service = new BackupService();",
            "}",
            "service.load();",
            "service.save();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "load");
    assert_eq!(rows[0].2, "");
    assert_eq!(rows[0].3, "unresolvedLikely");
    assert_eq!(rows[1].0, "service");
    assert_eq!(rows[1].1, "save");
    assert_eq!(rows[1].2, "");
    assert_eq!(rows[1].3, "unresolvedLikely");
    fs::remove_dir_all(root).unwrap();
}

fn workspace_connection(root: &std::path::Path) -> Connection {
    Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
}

fn query_member_access_target_rows(
    connection: &Connection,
) -> Vec<(String, String, String, String)> {
    let mut statement = connection
        .prepare(
            "select container, name, coalesce(symbol_id, ''), confidence
             from workspace_symbol_references
             where kind = 'memberAccess'
             order by line, column",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
