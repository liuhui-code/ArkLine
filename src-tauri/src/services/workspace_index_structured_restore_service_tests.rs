use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexStatus;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_structured_restore_service::restore_structured_sqlite_catalog_cache;

#[test]
fn restores_workspace_state_from_structured_sqlite_rows() {
    let connection = Connection::open_in_memory().unwrap();
    ensure_workspace_index_schema(&connection).unwrap();
    connection
        .execute(
            "insert into workspace_files (root_path, path) values (?1, ?2)",
            params!["/root", "src/Foo.ets"],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_symbols (
                root_path, source, kind, name, path, line, column, container
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "/root",
                "stub",
                "class",
                "Foo",
                "src/Foo.ets",
                3_i64,
                8_i64,
                "Module"
            ],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_index_metadata (
                root_path, status, indexed_at, partial_reason, updated_at
             ) values (?1, ?2, ?3, ?4, ?5)",
            params!["/root", "partial", 42_i64, "scan capped", 99_i64],
        )
        .unwrap();

    let state = restore_structured_sqlite_catalog_cache(&connection, "/root").unwrap();

    assert_eq!(state.status, WorkspaceIndexStatus::Partial);
    assert_eq!(state.root_path.as_deref(), Some("/root"));
    assert_eq!(state.file_paths, vec!["src/Foo.ets".to_string()]);
    assert_eq!(state.symbols[0].name, "Foo");
    assert_eq!(state.symbols[0].line, 3);
    assert_eq!(state.symbols[0].column, 8);
    assert_eq!(state.symbols[0].container.as_deref(), Some("Module"));
    assert_eq!(state.indexed_at, Some(42));
    assert_eq!(state.partial_reason.as_deref(), Some("scan capped"));
}

#[test]
fn empty_structured_sqlite_rows_return_restore_miss() {
    let connection = Connection::open_in_memory().unwrap();
    ensure_workspace_index_schema(&connection).unwrap();

    let error = restore_structured_sqlite_catalog_cache(&connection, "/root").unwrap_err();

    assert!(error.contains("Workspace structured SQLite catalog does not exist"));
}
