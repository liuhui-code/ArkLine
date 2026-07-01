use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_reference_index_service::query_references_by_symbol_id;
use crate::services::workspace_symbol_resolution_query_service::query_resolved_symbols_by_name;

#[test]
fn schema_creates_reference_index_tables_and_domain_version() {
    let connection = Connection::open_in_memory().unwrap();

    ensure_workspace_index_schema(&connection).unwrap();

    assert_table_exists(&connection, "workspace_symbol_references");
    assert_table_exists(&connection, "workspace_local_symbol_references");
    let versions = load_workspace_index_schema_versions(&connection).unwrap();
    assert_eq!(versions.get("reference"), Some(&1));
}

#[test]
fn workspace_refresh_indexes_identifier_references_with_resolved_symbol_targets() {
    let root = create_empty_workspace("reference-index-refresh");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Foo as Bar } from \"./Foo\";",
            "const service = new Bar();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let connection = workspace_connection(&root);
    let (symbol_id, confidence): (String, String) = connection
        .query_row(
            "select symbol_id, confidence
             from workspace_symbol_references
             where name = 'Bar' and line = 2
             limit 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(symbol_id.contains(":class:Foo:"));
    assert_eq!(confidence, "resolvedAlias");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queries_references_by_symbol_id_in_source_order() {
    let root = create_empty_workspace("reference-index-query");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    fs::write(
        source_dir.join("Index.ets"),
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

    let symbol = query_resolved_symbols_by_name(&root_path, "Foo", 1)
        .unwrap()
        .remove(0);
    let references = query_references_by_symbol_id(&root_path, &symbol.symbol_id, 8).unwrap();
    let lines = references
        .iter()
        .map(|reference| {
            (
                reference.name.as_str(),
                reference.line,
                reference.confidence.as_str(),
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(
        lines,
        vec![
            ("Foo", 1, "exact"),
            ("Bar", 2, "resolvedAlias"),
            ("Bar", 3, "resolvedAlias"),
        ]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queries_references_by_symbol_id_orders_by_confidence_before_path() {
    let root = create_empty_workspace("reference-index-confidence-order");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("ZFoo.ets"), "export class Foo {}\n").unwrap();
    fs::write(
        source_dir.join("AIndex.ets"),
        [
            "import { Foo as Bar } from \"./ZFoo\";",
            "const service = new Bar();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let symbol = query_resolved_symbols_by_name(&root_path, "Foo", 1)
        .unwrap()
        .remove(0);
    let references = query_references_by_symbol_id(&root_path, &symbol.symbol_id, 8).unwrap();
    let rows = references
        .iter()
        .map(|reference| {
            (
                reference.name.as_str(),
                reference.path.ends_with("ZFoo.ets"),
                reference.confidence.as_str(),
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(
        rows,
        vec![("Foo", true, "exact"), ("Bar", false, "resolvedAlias"),]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_indexes_declarations_as_exact_references() {
    let root = create_empty_workspace("reference-index-declaration");
    let source_dir = create_workspace_source_dir(&root);
    let foo_path = source_dir.join("Foo.ets");
    fs::write(&foo_path, "export class Foo {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let symbol = query_resolved_symbols_by_name(&root_path, "Foo", 1)
        .unwrap()
        .remove(0);
    let references = query_references_by_symbol_id(&root_path, &symbol.symbol_id, 8).unwrap();
    let exact = references
        .iter()
        .map(|reference| {
            (
                reference.name.as_str(),
                reference.kind.as_str(),
                reference.line,
                reference.column,
                reference.confidence.as_str(),
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(exact, vec![("Foo", "declaration", 1, 14, "exact")]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_refresh_normalizes_reference_confidence_values() {
    let root = create_empty_workspace("reference-index-confidence-values");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Foo as Bar } from \"./Foo\";",
            "const first = new Bar();",
            "const localOnly = helper;",
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
    let mut statement = connection
        .prepare(
            "select distinct confidence
             from workspace_symbol_references
             order by confidence",
        )
        .unwrap();
    let confidences = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(
        confidences,
        vec![
            "exact".to_string(),
            "resolvedAlias".to_string(),
            "unresolvedLikely".to_string(),
        ]
    );
    let local_rows: Vec<(String, String)> = connection
        .prepare(
            "select name, confidence
             from workspace_local_symbol_references
             where name in ('localOnly', 'helper')
             order by name",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(
        local_rows,
        vec![
            ("helper".to_string(), "localScope".to_string()),
            ("localOnly".to_string(), "localScope".to_string()),
        ]
    );
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
