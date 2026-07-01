use rusqlite::Connection;
use std::fs;

use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_symbol_resolution_service::resolve_workspace_symbols;

#[test]
fn schema_creates_symbol_resolution_tables_and_domain_version() {
    let connection = Connection::open_in_memory().unwrap();

    ensure_workspace_index_schema(&connection).unwrap();

    assert_table_exists(&connection, "workspace_resolved_symbols");
    assert_table_exists(&connection, "workspace_unresolved_symbols");
    let versions = load_workspace_index_schema_versions(&connection).unwrap();
    assert_eq!(versions.get("symbol_resolution"), Some(&1));
}

#[test]
fn resolves_stub_declarations_into_stable_symbol_rows() {
    let connection = Connection::open_in_memory().unwrap();
    ensure_workspace_index_schema(&connection).unwrap();
    connection
        .execute(
            "insert into workspace_stub_declarations (
                root_path, path, entity_id, kind, name, qualified_name, container, visibility,
                signature, line, column, end_line, end_column, modifiers_json, decorators_json
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            (
                "/workspace",
                "/workspace/entry/src/main/ets/Foo.ets",
                "stub:class:Foo:/workspace/entry/src/main/ets/Foo.ets:1:1",
                "class",
                "Foo",
                "Foo",
                Option::<String>::None,
                Some("public"),
                "class Foo",
                1_i64,
                1_i64,
                1_i64,
                10_i64,
                "[]",
                "[]",
            ),
        )
        .unwrap();

    let summary = resolve_workspace_symbols(&connection, "/workspace", 7).unwrap();

    assert_eq!(summary.resolved_count, 1);
    assert_eq!(summary.unresolved_count, 0);
    let symbol_id: String = connection
        .query_row(
            "select symbol_id from workspace_resolved_symbols where root_path = ?1 and name = ?2",
            ("/workspace", "Foo"),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        symbol_id,
        "project:/workspace/entry/src/main/ets/Foo.ets:class:Foo:1:1"
    );
}

#[test]
fn workspace_refresh_populates_resolved_symbols_from_stubs() {
    let root = create_empty_workspace("symbol-resolution-refresh");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let count: i64 = connection
        .query_row(
            "select count(*)
             from workspace_resolved_symbols
             where name = 'Foo' and kind = 'class'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(count, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_import_aliases_to_target_declarations() {
    let root = create_empty_workspace("symbol-resolution-import-alias");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "import { Foo as Bar } from \"./Foo\";\nlet value = Bar;\n",
    )
    .unwrap();
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let (path, target_symbol_id): (String, String) = connection
        .query_row(
            "select path, target_symbol_id
             from workspace_resolved_symbols
             where name = 'Bar' and source = 'import'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(path.ends_with("Index.ets"));
    assert!(target_symbol_id.contains(":class:Foo:"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_records_unresolved_import_symbols() {
    let root = create_empty_workspace("symbol-resolution-unresolved-import");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "import { Missing } from \"./Missing\";\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let reason: String = connection
        .query_row(
            "select reason
             from workspace_unresolved_symbols
             where name = 'Missing'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(reason, "unresolved import: ./Missing");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_resolves_re_export_aliases_to_target_declarations() {
    let root = create_empty_workspace("symbol-resolution-re-export");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "export { Foo as PublicFoo } from \"./Foo\";\n",
    )
    .unwrap();
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let (path, target_symbol_id): (String, String) = connection
        .query_row(
            "select path, target_symbol_id
             from workspace_resolved_symbols
             where name = 'PublicFoo' and source = 'export'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(path.ends_with("Index.ets"));
    assert!(target_symbol_id.contains(":class:Foo:"));
    fs::remove_dir_all(root).unwrap();
}

fn assert_table_exists(connection: &Connection, table_name: &str) {
    let count: i64 = connection
        .query_row(
            "select count(*)
             from sqlite_master
             where type = 'table' and name = ?1",
            [table_name],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "expected {table_name} table to exist");
}

fn workspace_connection(root: &std::path::Path) -> Connection {
    Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
}
