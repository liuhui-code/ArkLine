use rusqlite::Connection;

use crate::services::workspace_index_schema_version_service::{
    load_workspace_index_schema_versions, record_workspace_index_schema_versions,
    WORKSPACE_INDEX_SCHEMA_DOMAIN_COUNT,
};

#[test]
fn schema_versions_record_all_known_domains_idempotently() {
    let connection = Connection::open_in_memory().unwrap();

    record_workspace_index_schema_versions(&connection).unwrap();
    record_workspace_index_schema_versions(&connection).unwrap();
    let versions = load_workspace_index_schema_versions(&connection).unwrap();

    assert_eq!(versions.len(), WORKSPACE_INDEX_SCHEMA_DOMAIN_COUNT);
    assert_eq!(versions.get("catalog"), Some(&1));
    assert_eq!(versions.get("content"), Some(&1));
    assert_eq!(versions.get("entity"), Some(&1));
    assert_eq!(versions.get("stub"), Some(&1));
    assert_eq!(versions.get("dependency"), Some(&1));
    assert_eq!(versions.get("symbol_resolution"), Some(&1));
    assert_eq!(versions.get("reference"), Some(&1));
    assert_eq!(versions.get("discovery"), Some(&1));
}

#[test]
fn schema_versions_loader_creates_empty_version_table() {
    let connection = Connection::open_in_memory().unwrap();

    let versions = load_workspace_index_schema_versions(&connection).unwrap();
    let table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_master
             where type = 'table' and name = 'workspace_index_schema_versions'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert!(versions.is_empty());
    assert_eq!(table_count, 1);
}
