use rusqlite::Connection;

use crate::services::workspace_symbol_resolution_schema_service::create_symbol_resolution_tables;
use crate::services::workspace_symbol_resolution_unresolved_service::insert_unresolved_symbol;

#[test]
fn insert_unresolved_symbol_persists_reason_and_position() {
    let connection = Connection::open_in_memory().unwrap();
    create_symbol_resolution_tables(&connection).unwrap();

    insert_unresolved_symbol(
        &connection,
        "/workspace",
        "/workspace/src/Entry.ets",
        "Missing",
        "unresolved import: ./Missing",
        12,
        4,
        9,
    )
    .unwrap();

    let row: (String, String, String, i64, i64, i64) = connection
        .query_row(
            "select path, name, reason, line, column, indexed_generation
             from workspace_unresolved_symbols
             where root_path = ?1",
            ["/workspace"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();

    assert_eq!(
        row,
        (
            "/workspace/src/Entry.ets".to_string(),
            "Missing".to_string(),
            "unresolved import: ./Missing".to_string(),
            12,
            4,
            9,
        )
    );
}
