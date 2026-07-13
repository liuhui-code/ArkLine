use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn workspace_refresh_resolves_project_member_access_from_method_return_chain() {
    let root = create_empty_workspace("reference-index-project-member-method-return-chain");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserSession.ets"),
        "export class UserSession {\n  refresh() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("UserService.ets"),
        [
            "import { UserSession } from \"./UserSession\";",
            "export class UserService {",
            "  getSession(): UserSession {",
            "    return new UserSession();",
            "  }",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.getSession().refresh();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "getSession");
    assert!(rows[0].2.contains(":method:UserService.getSession:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].0, "service.getSession");
    assert_eq!(rows[1].1, "refresh");
    assert!(rows[1].2.contains(":method:UserSession.refresh:"));
    assert_eq!(rows[1].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_awaited_method_return_chain() {
    let root = create_empty_workspace("reference-index-project-member-awaited-method-chain");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserSession.ets"),
        "export class UserSession {\n  refresh() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("UserService.ets"),
        [
            "import { UserSession } from \"./UserSession\";",
            "export class UserService {",
            "  async getSession(): Promise<UserSession> {",
            "    return new UserSession();",
            "  }",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "async function run() {",
            "  const service = new UserService();",
            "  (await service.getSession()).refresh();",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "getSession");
    assert!(rows[0].2.contains(":method:UserService.getSession:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].0, "service.getSession");
    assert_eq!(rows[1].1, "refresh");
    assert!(rows[1].2.contains(":method:UserSession.refresh:"));
    assert_eq!(rows[1].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_field_chain() {
    let root = create_empty_workspace("reference-index-project-member-field-chain");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserSession.ets"),
        "export class UserSession {\n  refresh() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("UserService.ets"),
        [
            "import { UserSession } from \"./UserSession\";",
            "export class UserService {",
            "  session: UserSession;",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.session.refresh();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "session");
    assert!(rows[0].2.contains(":property:UserService.session:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].0, "service.session");
    assert_eq!(rows[1].1, "refresh");
    assert!(rows[1].2.contains(":method:UserSession.refresh:"));
    assert_eq!(rows[1].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_namespace_static_member_chain() {
    let root = create_empty_workspace("reference-index-project-namespace-static-chain");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Api.ets"),
        [
            "export namespace Api {",
            "  export class Client {",
            "    static create(): Client { return new Client(); }",
            "    refresh() {}",
            "  }",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Api } from \"./Api\";",
            "Api.Client.create().refresh();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].0, "Api");
    assert_eq!(rows[0].1, "Client");
    assert!(rows[0].2.contains(":class:Api.Client:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(rows[1].0, "Api.Client");
    assert_eq!(rows[1].1, "create");
    assert!(rows[1].2.contains(":method:Api.Client.create:"));
    assert_eq!(rows[1].3, "memberResolved");
    assert_eq!(rows[2].0, "Api.Client.create");
    assert_eq!(rows[2].1, "refresh");
    assert!(rows[2].2.contains(":method:Api.Client.refresh:"));
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
