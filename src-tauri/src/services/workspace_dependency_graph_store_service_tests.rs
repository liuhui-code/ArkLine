use rusqlite::{params, Connection};

use crate::services::workspace_dependency_graph_model_service::ImportRow;
use crate::services::workspace_dependency_graph_service::create_dependency_graph_tables;
use crate::services::workspace_dependency_graph_store_service::{
    insert_dependency_edge, insert_unresolved_import, load_dependency_graph_status,
    load_import_rows, load_import_rows_for_paths, load_re_export_rows,
    load_re_export_rows_for_paths, record_dependency_graph_status,
};

#[test]
fn loads_import_and_re_export_rows_in_source_order() {
    let connection = Connection::open_in_memory().unwrap();
    create_stub_tables(&connection);
    connection
        .execute(
            "insert into workspace_stub_imports (root_path, path, source_module, line, column)
             values (?1, ?2, ?3, ?4, ?5)",
            params!["/root", "src/B.ets", "./B", 4_i64, 8_i64],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_stub_imports (root_path, path, source_module, line, column)
             values (?1, ?2, ?3, ?4, ?5)",
            params!["/root", "src/A.ets", "./A", 2_i64, 6_i64],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_stub_exports (root_path, path, source_module, line, column)
             values (?1, ?2, ?3, ?4, ?5)",
            params!["/root", "src/Index.ets", "./A", 9_i64, 3_i64],
        )
        .unwrap();

    let imports = load_import_rows(&connection, "/root").unwrap();
    let exports = load_re_export_rows(&connection, "/root").unwrap();

    assert_eq!(imports[0].from_path, "src/A.ets");
    assert_eq!(imports[0].line, 2);
    assert_eq!(imports[1].from_path, "src/B.ets");
    assert_eq!(
        exports,
        vec![ImportRow {
            from_path: "src/Index.ets".to_string(),
            source_module: "./A".to_string(),
            line: 9,
            column: 3,
        }]
    );
}

#[test]
fn inserts_dependency_edges_reverse_rows_and_unresolved_imports() {
    let connection = Connection::open_in_memory().unwrap();
    create_dependency_graph_tables(&connection).unwrap();
    let import = ImportRow {
        from_path: "src/Index.ets".to_string(),
        source_module: "./Foo".to_string(),
        line: 3,
        column: 12,
    };

    insert_dependency_edge(&connection, "/root", &import, "src/Foo.ets", "import").unwrap();
    insert_unresolved_import(&connection, "/root", &import).unwrap();

    let edge_count: i64 = connection
        .query_row(
            "select count(*) from workspace_dependency_edges",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let reverse_count: i64 = connection
        .query_row(
            "select count(*) from workspace_dependency_reverse",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let unresolved_count: i64 = connection
        .query_row(
            "select count(*) from workspace_unresolved_imports",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(edge_count, 1);
    assert_eq!(reverse_count, 1);
    assert_eq!(unresolved_count, 1);
}

#[test]
fn incremental_loads_only_rows_for_the_requested_paths() {
    let connection = Connection::open_in_memory().unwrap();
    create_stub_tables(&connection);
    for (table, path, source) in [
        ("workspace_stub_imports", "src/A.ets", "./TargetA"),
        ("workspace_stub_imports", "src/B.ets", "./TargetB"),
        ("workspace_stub_exports", "src/A.ets", "./ExportA"),
        ("workspace_stub_exports", "src/B.ets", "./ExportB"),
    ] {
        connection
            .execute(
                &format!(
                    "insert into {table} (root_path, path, source_module, line, column)
                     values (?1, ?2, ?3, 1, 1)"
                ),
                params!["/root", path, source],
            )
            .unwrap();
    }

    let paths = vec!["src/B.ets".to_string()];
    let imports = load_import_rows_for_paths(&connection, "/root", &paths).unwrap();
    let exports = load_re_export_rows_for_paths(&connection, "/root", &paths).unwrap();

    assert_eq!(imports.len(), 1);
    assert_eq!(imports[0].source_module, "./TargetB");
    assert_eq!(exports.len(), 1);
    assert_eq!(exports[0].source_module, "./ExportB");
}

#[test]
fn records_and_loads_dependency_graph_status() {
    let connection = Connection::open_in_memory().unwrap();
    create_dependency_graph_tables(&connection).unwrap();

    record_dependency_graph_status(&connection, "/root", "stale", Some("config")).unwrap();
    let status = load_dependency_graph_status(&connection, "/root")
        .unwrap()
        .unwrap();

    assert_eq!(status.status, "stale");
    assert_eq!(status.reason.as_deref(), Some("config"));
}

fn create_stub_tables(connection: &Connection) {
    connection
        .execute(
            "create table workspace_stub_imports (
                root_path text not null,
                path text not null,
                source_module text not null,
                line integer not null,
                column integer not null
             )",
            [],
        )
        .unwrap();
    connection
        .execute(
            "create table workspace_stub_exports (
                root_path text not null,
                path text not null,
                source_module text,
                line integer not null,
                column integer not null
             )",
            [],
        )
        .unwrap();
}
