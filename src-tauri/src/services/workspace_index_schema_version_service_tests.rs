use rusqlite::Connection;
use std::collections::HashMap;

use crate::services::workspace_index_schema_version_service::{
    load_workspace_index_schema_versions, plan_workspace_index_schema_version_actions,
    record_workspace_index_schema_versions, WorkspaceIndexSchemaVersionStatus,
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
fn schema_versions_do_not_overwrite_persisted_domain_versions() {
    let connection = Connection::open_in_memory().unwrap();

    record_workspace_index_schema_versions(&connection).unwrap();
    connection
        .execute(
            "update workspace_index_schema_versions
             set version = 0
             where domain = 'content'",
            [],
        )
        .unwrap();
    record_workspace_index_schema_versions(&connection).unwrap();
    let versions = load_workspace_index_schema_versions(&connection).unwrap();

    assert_eq!(versions.get("content"), Some(&0));
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

#[test]
fn schema_version_actions_report_compatible_domains() {
    let connection = Connection::open_in_memory().unwrap();
    record_workspace_index_schema_versions(&connection).unwrap();
    let versions = load_workspace_index_schema_versions(&connection).unwrap();

    let actions = plan_workspace_index_schema_version_actions(&versions);

    assert_eq!(actions.len(), WORKSPACE_INDEX_SCHEMA_DOMAIN_COUNT);
    assert!(actions
        .iter()
        .all(|action| action.status == WorkspaceIndexSchemaVersionStatus::Compatible));
}

#[test]
fn schema_version_actions_report_missing_and_incompatible_domains() {
    let mut versions = HashMap::new();
    versions.insert("catalog".to_string(), 0);
    versions.insert("content".to_string(), 99);

    let actions = plan_workspace_index_schema_version_actions(&versions);
    let catalog = actions
        .iter()
        .find(|action| action.domain == "catalog")
        .expect("catalog action should exist");
    let content = actions
        .iter()
        .find(|action| action.domain == "content")
        .expect("content action should exist");
    let sdk = actions
        .iter()
        .find(|action| action.domain == "sdk")
        .expect("sdk action should exist");

    assert_eq!(catalog.expected_version, 1);
    assert_eq!(catalog.persisted_version, Some(0));
    assert_eq!(catalog.status, WorkspaceIndexSchemaVersionStatus::NeedsRebuild);
    assert_eq!(content.persisted_version, Some(99));
    assert_eq!(content.status, WorkspaceIndexSchemaVersionStatus::NeedsRebuild);
    assert_eq!(sdk.persisted_version, None);
    assert_eq!(sdk.status, WorkspaceIndexSchemaVersionStatus::MissingVersion);
}
