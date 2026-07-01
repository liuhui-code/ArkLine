use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn workspace_refresh_resolves_project_member_access_from_chained_generic_fields() {
    let root = create_empty_workspace("reference-index-project-member-chained-generic");
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
            "class Response<T> {",
            "  data: T;",
            "}",
            "class Box<T> {",
            "  value: T;",
            "}",
            "const box: Box<Response<UserService>>;",
            "box.value.data.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let rows = query_member_access_target_rows(&workspace_connection(&root));

    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[0],
        (
            "box".to_string(),
            "value".to_string(),
            "".to_string(),
            "unresolvedLikely".to_string()
        )
    );
    assert!(rows[1].2.contains(":property:Response.data:"));
    assert_eq!(rows[1].3, "memberResolved");
    assert!(rows[2].2.contains(":method:UserService.load:"));
    assert_eq!(rows[2].3, "memberResolved");
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
