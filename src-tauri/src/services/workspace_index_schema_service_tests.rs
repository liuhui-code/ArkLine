use rusqlite::Connection;

use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};

#[test]
fn migrates_workspace_index_schema_and_records_domain_versions() {
    let connection = Connection::open_in_memory().unwrap();

    ensure_workspace_index_schema(&connection).unwrap();
    ensure_workspace_index_schema(&connection).unwrap();
    let versions = load_workspace_index_schema_versions(&connection).unwrap();

    assert_eq!(versions.get("catalog"), Some(&1));
    assert_eq!(versions.get("content"), Some(&1));
    assert_eq!(versions.get("symbol"), Some(&1));
    assert_eq!(versions.get("stub"), Some(&1));
    assert_eq!(versions.get("fingerprint"), Some(&1));
    assert_eq!(versions.get("sdk"), Some(&1));
    assert_eq!(versions.get("task_journal"), Some(&1));
    assert_eq!(versions.get("entity"), Some(&1));

    let catalog_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_master where type = 'table' and name = 'workspace_catalog'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let schema_count: i64 = connection
        .query_row(
            "select count(*) from workspace_index_schema_versions",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(catalog_count, 1);
    let entity_table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_master where type = 'table' and name = 'workspace_symbol_entities'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(entity_table_count, 1);
    assert_eq!(schema_count, 8);
}
