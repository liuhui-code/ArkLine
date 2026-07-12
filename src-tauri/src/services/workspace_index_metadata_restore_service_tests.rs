use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexStatus;
use crate::services::workspace_index_metadata_restore_service::restore_metadata;

#[test]
fn restore_metadata_reads_status_generation_and_partial_reason() {
    let connection = connection_with_metadata();
    connection
        .execute(
            "insert into workspace_index_metadata (
                root_path, status, indexed_at, partial_reason, updated_at
             ) values (?1, 'partial', 42, 'scan capped', 43)",
            params!["\\workspace"],
        )
        .unwrap();

    let metadata = restore_metadata(&connection, "\\workspace")
        .unwrap()
        .unwrap();

    assert_eq!(metadata.status, WorkspaceIndexStatus::Partial);
    assert_eq!(metadata.indexed_at, Some(42));
    assert_eq!(metadata.partial_reason.as_deref(), Some("scan capped"));
}

#[test]
fn restore_metadata_maps_unknown_status_to_empty() {
    let connection = connection_with_metadata();
    connection
        .execute(
            "insert into workspace_index_metadata (
                root_path, status, indexed_at, partial_reason, updated_at
             ) values (?1, 'unexpected', null, null, 43)",
            params!["\\workspace"],
        )
        .unwrap();

    let metadata = restore_metadata(&connection, "\\workspace")
        .unwrap()
        .unwrap();

    assert_eq!(metadata.status, WorkspaceIndexStatus::Empty);
    assert_eq!(metadata.indexed_at, None);
    assert_eq!(metadata.partial_reason, None);
}

fn connection_with_metadata() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute(
            "create table workspace_index_metadata (
                root_path text primary key,
                status text not null,
                indexed_at integer,
                partial_reason text,
                updated_at integer not null
            )",
            [],
        )
        .unwrap();
    connection
}
