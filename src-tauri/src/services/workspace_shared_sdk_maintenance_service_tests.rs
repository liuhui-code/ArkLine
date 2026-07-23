use std::fs;
use std::path::{Path, PathBuf};

use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_shared_sdk_artifact_service::{
    SharedSdkArtifactIdentity, SharedSdkArtifactStatus, SharedSdkArtifactStore,
};
use crate::services::workspace_shared_sdk_connection_service::{
    clear_shared_sdk_store_state, shared_sdk_store_snapshot, with_shared_sdk_reader,
};
use crate::services::workspace_shared_sdk_maintenance_service::{
    inspect_shared_sdk_store, maintain_shared_sdk_store, SharedSdkRetentionPolicy,
};

#[test]
fn failed_artifact_cleanup_rolls_back_symbols_and_metadata() {
    let path = unique_store_path("rollback");
    let (store, identity) = create_aged_artifact(&path);
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch(
            "create trigger fail_artifact_cleanup
             before delete on shared_sdk_artifacts
             begin
               select raise(fail, 'forced cleanup failure');
             end;",
        )
        .unwrap();

    let error = maintain_shared_sdk_store(&path, 20_000, retention_policy()).unwrap_err();

    assert!(error.contains("forced cleanup failure"));
    assert_eq!(
        store.status(&identity).unwrap(),
        Some(SharedSdkArtifactStatus::Ready)
    );
    assert_eq!(
        store
            .query_name_candidates(&identity, "width", 8)
            .unwrap()
            .len(),
        1
    );
    cleanup_store(&path);
}

#[test]
fn active_reader_keeps_a_consistent_snapshot_while_cleanup_commits() {
    let path = unique_store_path("reader-snapshot");
    let (store, identity) = create_aged_artifact(&path);

    with_shared_sdk_reader(&path, |connection| {
        connection
            .execute_batch("begin")
            .map_err(|error| error.to_string())?;
        assert_eq!(artifact_count(connection), 1);
        let report = maintain_shared_sdk_store(&path, 20_000, retention_policy())?;
        assert_eq!(report.deleted_artifact_count, 1);
        assert_eq!(shared_sdk_store_snapshot(&path).active_readers, 1);
        assert_eq!(artifact_count(connection), 1);
        connection
            .execute_batch("rollback")
            .map_err(|error| error.to_string())
    })
    .unwrap();

    assert_eq!(store.status(&identity).unwrap(), None);
    assert_eq!(shared_sdk_store_snapshot(&path).active_readers, 0);
    cleanup_store(&path);
}

#[test]
fn store_stats_report_physical_db_wal_and_freelist_evidence() {
    let path = unique_store_path("physical-stats");
    let (_store, _identity) = create_aged_artifact(&path);
    let connection = rusqlite::Connection::open(&path).unwrap();
    let page_size: u64 = connection
        .query_row("pragma page_size", [], |row| row.get(0))
        .unwrap();
    let freelist_pages: u64 = connection
        .query_row("pragma freelist_count", [], |row| row.get(0))
        .unwrap();
    drop(connection);

    let stats = inspect_shared_sdk_store(&path).unwrap();
    let expected_wal_bytes = fs::metadata(path.with_extension("sqlite-wal"))
        .map(|metadata| metadata.len())
        .unwrap_or_default();

    assert!(stats.db_size_bytes > 0);
    assert_eq!(stats.wal_size_bytes, expected_wal_bytes);
    assert_eq!(
        stats.freelist_bytes,
        page_size.saturating_mul(freelist_pages)
    );
    cleanup_store(&path);
}

fn create_aged_artifact(path: &Path) -> (SharedSdkArtifactStore, SharedSdkArtifactIdentity) {
    let store = SharedSdkArtifactStore::open(path).unwrap();
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    store
        .replace_ready(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();
    rusqlite::Connection::open(path)
        .unwrap()
        .execute(
            "update shared_sdk_artifacts set updated_at = 0 where artifact_key = ?1",
            [&identity.artifact_key],
        )
        .unwrap();
    (store, identity)
}

fn artifact_count(connection: &rusqlite::Connection) -> i64 {
    connection
        .query_row("select count(*) from shared_sdk_artifacts", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn retention_policy() -> SharedSdkRetentionPolicy {
    SharedSdkRetentionPolicy {
        stale_building_ms: 1,
        stale_failed_ms: 1,
        unreferenced_ready_ms: 1,
        stale_reference_ms: 1,
        artifact_limit: 8,
    }
}

fn symbol(name: &str, path: &str) -> WorkspaceSdkSymbol {
    WorkspaceSdkSymbol {
        kind: "method".to_string(),
        name: name.to_string(),
        path: path.to_string(),
        line: 2,
        column: 3,
        container: Some("TextAttribute".to_string()),
        signature: None,
    }
}

fn unique_store_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "arkline-shared-sdk-maintenance-{name}-{}.sqlite",
        uuid::Uuid::new_v4()
    ))
}

fn cleanup_store(path: &Path) {
    clear_shared_sdk_store_state(path);
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = fs::remove_file(path.with_extension("sqlite-shm"));
}
