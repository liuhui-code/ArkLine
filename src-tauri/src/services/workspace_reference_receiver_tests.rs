use std::fs;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn member_context_load_does_not_wait_on_its_own_workspace_writer() {
    let root = create_empty_workspace("reference-member-context-writer");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Index.ets"), "service.load();\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let mut connection = workspace_connection(&root);
    let transaction = connection.transaction().unwrap();
    transaction
        .execute("create table writer_lock_probe (value integer)", [])
        .unwrap();
    let started = Instant::now();
    crate::services::workspace_reference_member_index_service::WorkspaceMemberReferenceContext::load(
        &transaction,
        &root_path.replace('/', "\\"),
    )
    .unwrap();

    assert!(started.elapsed() < Duration::from_millis(500));
    transaction.rollback().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_indexes_member_access_with_owner_context() {
    let root = create_empty_workspace("reference-index-member-access");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "Text('hi').width(12)\nservice.load()\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_rows(&connection);

    assert_eq!(
        rows,
        vec![
            (
                "Text".to_string(),
                "width".to_string(),
                1,
                12,
                "unresolvedLikely".to_string(),
            ),
            (
                "service".to_string(),
                "load".to_string(),
                2,
                9,
                "unresolvedLikely".to_string(),
            ),
        ]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_member_access_to_active_sdk_symbols() {
    let root = create_empty_workspace("reference-index-sdk-member-access");
    let source_dir = create_workspace_source_dir(&root);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "Text('hi').width(12)\nservice.load()\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "Text");
    assert_eq!(rows[0].1, "width");
    assert!(rows[0].2.starts_with("sdk:"));
    assert!(rows[0].2.contains(":method:Text:width:"));
    assert_eq!(rows[0].3, "memberResolved");
    assert_eq!(
        rows[1],
        (
            "service".to_string(),
            "load".to_string(),
            "".to_string(),
            "unresolvedLikely".to_string(),
        )
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_new_expression_receiver() {
    assert_project_member_reference(
        "reference-index-project-member-access",
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.load();",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_imported_project_member_when_same_named_class_exists() {
    let root = create_empty_workspace("reference-index-imported-member-conflict");
    let source_dir = create_workspace_source_dir(&root);
    fs::create_dir_all(source_dir.join("afeature")).unwrap();
    fs::create_dir_all(source_dir.join("zfeature")).unwrap();
    fs::write(
        source_dir.join("zfeature").join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("afeature").join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { UserService as ActiveService } from \"./zfeature/UserService\";",
            "const service = new ActiveService();",
            "service.load();",
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

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "service");
    assert_eq!(rows[0].1, "load");
    assert!(rows[0].2.starts_with("project:"));
    assert!(rows[0]
        .2
        .contains("\\zfeature\\UserService.ets:method:UserService.load:"));
    assert_eq!(rows[0].3, "memberResolved");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_keeps_unresolved_imported_receiver_unresolved() {
    let root = create_empty_workspace("reference-index-unresolved-import-member");
    let source_dir = create_workspace_source_dir(&root);
    fs::create_dir_all(source_dir.join("other")).unwrap();
    fs::write(
        source_dir.join("other").join("MissingService.ets"),
        "export class MissingService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { MissingService } from \"./missing/MissingService\";",
            "const service = new MissingService();",
            "service.load();",
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

    assert_eq!(
        rows,
        vec![(
            "service".to_string(),
            "load".to_string(),
            "".to_string(),
            "unresolvedLikely".to_string(),
        )]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_parameter_type() {
    assert_project_member_reference(
        "reference-index-project-member-param",
        [
            "import { UserService } from \"./UserService\";",
            "function run(service: UserService) {",
            "  service.load();",
            "}",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_field_type() {
    assert_project_member_reference(
        "reference-index-project-member-field",
        [
            "import { UserService } from \"./UserService\";",
            "class PageController {",
            "  private service: UserService = new UserService();",
            "  run() {",
            "    this.service.load();",
            "  }",
            "}",
        ]
        .join("\n"),
        vec![
            ("this", "service", "unresolvedLikely"),
            ("this.service", "load", "memberResolved"),
        ],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_function_return_type() {
    assert_project_member_reference(
        "reference-index-project-member-return",
        [
            "import { UserService } from \"./UserService\";",
            "function createService(): UserService {",
            "  return new UserService();",
            "}",
            "const service = createService();",
            "service.load();",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_async_promise_return_type() {
    assert_project_member_reference(
        "reference-index-project-member-async-promise-return",
        [
            "import { UserService } from \"./UserService\";",
            "async function createService(): Promise<UserService> {",
            "  return new UserService();",
            "}",
            "const service = await createService();",
            "service.load();",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_nullable_typed_variable() {
    assert_project_member_reference(
        "reference-index-project-member-nullable-typed-variable",
        [
            "import { UserService } from \"./UserService\";",
            "let service: UserService | undefined;",
            "if (service) {",
            "  service.load();",
            "}",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_optional_chain() {
    assert_project_member_reference(
        "reference-index-project-member-optional-chain",
        [
            "import { UserService } from \"./UserService\";",
            "let service: UserService | undefined;",
            "service?.load();",
        ]
        .join("\n"),
        vec![("service", "load", "memberResolved")],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_generic_field_type() {
    assert_project_member_reference(
        "reference-index-project-member-generic-field",
        [
            "import { UserService } from \"./UserService\";",
            "class Box<T> {",
            "  value: T;",
            "}",
            "const box: Box<UserService>;",
            "box.value.load();",
        ]
        .join("\n"),
        vec![
            ("box", "value", "unresolvedLikely"),
            ("box.value", "load", "memberResolved"),
        ],
    );
}

#[test]
fn workspace_refresh_resolves_project_member_access_from_imported_generic_field_type() {
    let root = create_empty_workspace("reference-index-project-member-imported-generic-field");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Box.ets"),
        "export class Box<T> {\n  value: T;\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Box } from \"./Box\";",
            "import { UserService } from \"./UserService\";",
            "const box: Box<UserService>;",
            "box.value.load();",
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

    assert_eq!(
        rows,
        vec![
            (
                "box".to_string(),
                "value".to_string(),
                "".to_string(),
                "unresolvedLikely".to_string(),
            ),
            (
                "box.value".to_string(),
                "load".to_string(),
                rows[1].2.clone(),
                "memberResolved".to_string(),
            ),
        ]
    );
    assert!(rows[1].2.starts_with("project:"));
    assert!(rows[1].2.contains(":method:UserService.load:"));
    fs::remove_dir_all(root).unwrap();
}

fn assert_project_member_reference(
    name: &str,
    app_content: String,
    expected: Vec<(&str, &str, &str)>,
) {
    let root = create_empty_workspace(name);
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(source_dir.join("Index.ets"), app_content).unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let rows = query_member_access_target_rows(&connection);

    assert_eq!(rows.len(), expected.len());
    for (row, (container, name, confidence)) in rows.iter().zip(expected) {
        assert_eq!(row.0, container);
        assert_eq!(row.1, name);
        assert_eq!(row.3, confidence);
        if confidence == "memberResolved" {
            assert!(row.2.starts_with("project:"));
            assert!(row.2.contains(":method:UserService.load:"));
        }
    }
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

fn query_member_access_rows(connection: &Connection) -> Vec<(String, String, i64, i64, String)> {
    let mut statement = connection
        .prepare(
            "select container, name, line, column, confidence
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
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
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
