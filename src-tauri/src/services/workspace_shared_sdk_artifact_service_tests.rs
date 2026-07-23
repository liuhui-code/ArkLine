use std::fs;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;
use crate::services::workspace_sdk_api_cache_service::sdk_api_file_manifest_fingerprint;
use crate::services::workspace_sdk_api_scan_plan_service::plan_sdk_api_scan;
use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_sdk_shared_bridge_service::{
    load_active_sdk_identity, try_reuse_ready_shared_sdk_artifact_from_store,
};
use crate::services::workspace_shared_sdk_artifact_service::{
    SharedSdkArtifactIdentity, SharedSdkArtifactStatus, SharedSdkArtifactStore,
};
use crate::services::workspace_shared_sdk_connection_service::{
    clear_shared_sdk_store_state, shared_sdk_store_snapshot, with_shared_sdk_reader,
};
use crate::services::workspace_shared_sdk_maintenance_service::{
    inspect_shared_sdk_store, maintain_shared_sdk_store, record_shared_sdk_workspace_reference,
    refresh_shared_sdk_workspace_reference_if_due, SharedSdkRetentionPolicy,
};

fn unique_store_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-shared-sdk-{name}-{suffix}.sqlite"))
}

fn symbol(name: &str, path: &str) -> WorkspaceSdkSymbol {
    WorkspaceSdkSymbol {
        kind: "method".to_string(),
        name: name.to_string(),
        path: path.to_string(),
        line: 2,
        column: 3,
        container: Some("TextAttribute".to_string()),
        signature: Some(format!("{name}(value: Length): TextAttribute")),
    }
}

#[test]
fn shared_artifact_is_reused_by_independent_store_handles() {
    let path = unique_store_path("reuse");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    let writer = SharedSdkArtifactStore::open(&path).unwrap();
    writer
        .replace_ready(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();

    let reader = SharedSdkArtifactStore::open(&path).unwrap();
    let matches = reader.query_name_candidates(&identity, "wid", 16).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].name, "width");
    assert_eq!(
        reader.status(&identity).unwrap(),
        Some(SharedSdkArtifactStatus::Ready)
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn replacing_one_sdk_artifact_does_not_remove_another_version() {
    let path = unique_store_path("versions");
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    let old = SharedSdkArtifactIdentity::new("/sdk/openharmony", "4.0", "manifest-old");
    let current = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-current");
    store
        .replace_ready(&old, &[symbol("legacyWidth", "/sdk/old.d.ts")])
        .unwrap();
    store
        .replace_ready(&current, &[symbol("width", "/sdk/current.d.ts")])
        .unwrap();

    assert_eq!(
        store
            .query_name_candidates(&old, "legacy", 8)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store
            .query_name_candidates(&current, "width", 8)
            .unwrap()
            .len(),
        1
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn chunked_artifact_is_not_ready_until_explicitly_completed() {
    let path = unique_store_path("chunked");
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    store.begin(&identity).unwrap();
    store
        .append(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();

    assert_eq!(
        store.status(&identity).unwrap(),
        Some(SharedSdkArtifactStatus::Building)
    );
    assert_eq!(
        store
            .query_name_candidates(&identity, "width", 8)
            .unwrap()
            .len(),
        1
    );

    store.mark_ready(&identity).unwrap();
    assert_eq!(
        store.status(&identity).unwrap(),
        Some(SharedSdkArtifactStatus::Ready)
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn ready_artifact_binds_multiple_workspaces_without_copying_sdk_symbols() {
    let root = unique_store_path("workspace-reuse-root").with_extension("");
    let first_workspace = root.join("first");
    let second_workspace = root.join("second");
    let sdk_root = root.join("sdk");
    fs::create_dir_all(&first_workspace).unwrap();
    fs::create_dir_all(&second_workspace).unwrap();
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("common.d.ts"),
        "declare class TextAttribute { width(value: Length): TextAttribute; }\n",
    )
    .unwrap();
    migrate_workspace_index_schema(&first_workspace.to_string_lossy()).unwrap();
    migrate_workspace_index_schema(&second_workspace.to_string_lossy()).unwrap();
    let files = plan_sdk_api_scan(&sdk_root.to_string_lossy())
        .unwrap()
        .files;
    let fingerprint = sdk_api_file_manifest_fingerprint(&files).unwrap();
    let identity = SharedSdkArtifactIdentity::new(&sdk_root.to_string_lossy(), "5.0", &fingerprint);
    let store_path = root.join("shared.sqlite");
    SharedSdkArtifactStore::open(&store_path)
        .unwrap()
        .replace_ready(&identity, &[symbol("width", &files[0])])
        .unwrap();

    let first_count = try_reuse_ready_shared_sdk_artifact_from_store(
        &first_workspace.to_string_lossy(),
        &sdk_root.to_string_lossy(),
        "5.0",
        &store_path,
    )
    .unwrap();
    let second_count = try_reuse_ready_shared_sdk_artifact_from_store(
        &second_workspace.to_string_lossy(),
        &sdk_root.to_string_lossy(),
        "5.0",
        &store_path,
    )
    .unwrap();

    assert_eq!(first_count, Some(1));
    assert_eq!(second_count, Some(1));
    assert_eq!(
        load_active_sdk_identity(&first_workspace.to_string_lossy())
            .unwrap()
            .unwrap()
            .artifact_key,
        load_active_sdk_identity(&second_workspace.to_string_lossy())
            .unwrap()
            .unwrap()
            .artifact_key
    );
    assert_eq!(workspace_local_sdk_symbol_count(&first_workspace), 0);
    assert_eq!(workspace_local_sdk_symbol_count(&second_workspace), 0);
    assert_eq!(
        inspect_shared_sdk_store(&store_path)
            .unwrap()
            .reference_count,
        2
    );
    fs::remove_dir_all(root).unwrap();
}

fn workspace_local_sdk_symbol_count(workspace: &std::path::Path) -> i64 {
    rusqlite::Connection::open(
        workspace
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
    .query_row("select count(*) from workspace_sdk_symbols", [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn concurrent_artifact_appends_keep_all_symbols() {
    let path = unique_store_path("concurrent");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    SharedSdkArtifactStore::open(&path)
        .unwrap()
        .begin(&identity)
        .unwrap();
    let handles = (0..4)
        .map(|index| {
            let path = path.clone();
            let identity = identity.clone();
            std::thread::spawn(move || {
                SharedSdkArtifactStore::open(&path)
                    .unwrap()
                    .append(
                        &identity,
                        &[symbol(
                            &format!("method{index}"),
                            &format!("/sdk/file{index}.d.ts"),
                        )],
                    )
                    .unwrap();
            })
        })
        .collect::<Vec<_>>();
    for handle in handles {
        handle.join().unwrap();
    }

    let store = SharedSdkArtifactStore::open(&path).unwrap();
    assert_eq!(store.count_symbols(&identity).unwrap(), 4);
    fs::remove_file(path).unwrap();
}

#[test]
fn failed_artifact_replace_preserves_previous_ready_snapshot() {
    let path = unique_store_path("atomic-replace");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    store
        .replace_ready(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch(
            "create trigger fail_shared_sdk_insert
             before insert on shared_sdk_symbols
             when NEW.name = 'broken'
             begin
               select raise(fail, 'forced shared SDK failure');
             end;",
        )
        .unwrap();

    assert!(store
        .replace_ready(&identity, &[symbol("broken", "/sdk/broken.d.ts")])
        .unwrap_err()
        .contains("forced shared SDK failure"));
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
    fs::remove_file(path).unwrap();
}

#[test]
fn shared_sdk_trigram_query_stays_bounded_for_large_artifact() {
    let path = unique_store_path("query-performance");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-large");
    let mut symbols = (0..5_000)
        .map(|index| {
            symbol(
                &format!("unrelatedMethod{index:05}"),
                &format!("/sdk/api{index:05}.d.ts"),
            )
        })
        .collect::<Vec<_>>();
    symbols.push(symbol("targetNeedleApi", "/sdk/target.d.ts"));
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    store.replace_ready(&identity, &symbols).unwrap();
    let mut durations = (0..20)
        .map(|_| {
            let started = Instant::now();
            let matches = store
                .query_name_candidates(&identity, "needle", 64)
                .unwrap();
            assert!(matches.iter().any(|item| item.name == "targetNeedleApi"));
            started.elapsed()
        })
        .collect::<Vec<_>>();
    durations.sort();
    let p95 = durations[19];

    assert!(p95.as_millis() < 100, "shared SDK query p95 was {p95:?}");
    fs::remove_file(path).unwrap();
}

#[test]
fn retention_keeps_referenced_artifact_then_removes_it_after_reference_expiry() {
    let path = unique_store_path("retention-reference");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    store
        .replace_ready(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();
    age_artifact(&path, &identity.artifact_key);
    record_shared_sdk_workspace_reference(
        &path,
        "/workspace/app",
        &identity.artifact_key,
        10_000,
    )
    .unwrap();
    let policy = test_retention_policy(1);

    let protected = maintain_shared_sdk_store(&path, 10_050, policy).unwrap();
    assert_eq!(protected.deleted_artifact_count, 0);
    assert_eq!(store.status(&identity).unwrap(), Some(SharedSdkArtifactStatus::Ready));

    let expired = maintain_shared_sdk_store(&path, 20_000, policy).unwrap();
    assert_eq!(expired.deleted_reference_count, 1);
    assert_eq!(expired.deleted_artifact_count, 1);
    assert_eq!(expired.deleted_symbol_count, 1);
    assert_eq!(store.status(&identity).unwrap(), None);
    cleanup_store(&path);
}

#[test]
fn retention_deletes_only_the_bounded_number_of_unreferenced_artifacts() {
    let path = unique_store_path("retention-bound");
    let store = SharedSdkArtifactStore::open(&path).unwrap();
    for index in 0..3 {
        let identity = SharedSdkArtifactIdentity::new(
            "/sdk/openharmony",
            &format!("{index}.0"),
            &format!("manifest-{index}"),
        );
        store
            .replace_ready(
                &identity,
                &[symbol(&format!("method{index}"), "/sdk/common.d.ts")],
            )
            .unwrap();
        age_artifact(&path, &identity.artifact_key);
    }
    let mut policy = test_retention_policy(1);
    policy.artifact_limit = 2;

    let first = maintain_shared_sdk_store(&path, 20_000, policy).unwrap();
    assert_eq!(first.deleted_artifact_count, 2);
    assert_eq!(first.remaining_artifact_count, 1);
    let second = maintain_shared_sdk_store(&path, 20_001, policy).unwrap();
    assert_eq!(second.deleted_artifact_count, 1);
    assert_eq!(second.remaining_artifact_count, 0);
    cleanup_store(&path);
}

#[test]
fn shared_sdk_reader_is_query_only_and_reports_its_active_lease() {
    let path = unique_store_path("reader-lease");
    SharedSdkArtifactStore::open(&path).unwrap();

    with_shared_sdk_reader(&path, |connection| {
        assert_eq!(shared_sdk_store_snapshot(&path).active_readers, 1);
        let error = connection
            .execute("delete from shared_sdk_artifacts", [])
            .unwrap_err();
        assert!(error.to_string().contains("readonly"));
        Ok(())
    })
    .unwrap();

    let snapshot = shared_sdk_store_snapshot(&path);
    assert_eq!(snapshot.active_readers, 0);
    assert!(snapshot.revision >= 1);
    cleanup_store(&path);
}

#[test]
fn workspace_reference_refresh_is_throttled_after_the_first_touch() {
    let path = unique_store_path("reference-throttle");
    let identity = SharedSdkArtifactIdentity::new("/sdk/openharmony", "5.0", "manifest-a");
    SharedSdkArtifactStore::open(&path)
        .unwrap()
        .replace_ready(&identity, &[symbol("width", "/sdk/common.d.ts")])
        .unwrap();
    let before = shared_sdk_store_snapshot(&path).revision;

    refresh_shared_sdk_workspace_reference_if_due(
        &path,
        "/workspace/app",
        &identity.artifact_key,
    )
    .unwrap();
    let first = shared_sdk_store_snapshot(&path).revision;
    refresh_shared_sdk_workspace_reference_if_due(
        &path,
        "/workspace/app",
        &identity.artifact_key,
    )
    .unwrap();

    assert_eq!(first, before + 1);
    assert_eq!(shared_sdk_store_snapshot(&path).revision, first);
    assert_eq!(inspect_shared_sdk_store(&path).unwrap().reference_count, 1);
    cleanup_store(&path);
}

fn test_retention_policy(age_ms: u128) -> SharedSdkRetentionPolicy {
    SharedSdkRetentionPolicy {
        stale_building_ms: age_ms,
        stale_failed_ms: age_ms,
        unreferenced_ready_ms: age_ms,
        stale_reference_ms: 100,
        artifact_limit: 8,
    }
}

fn age_artifact(path: &std::path::Path, artifact_key: &str) {
    rusqlite::Connection::open(path)
        .unwrap()
        .execute(
            "update shared_sdk_artifacts set updated_at = 0 where artifact_key = ?1",
            [artifact_key],
        )
        .unwrap();
}

fn cleanup_store(path: &std::path::Path) {
    clear_shared_sdk_store_state(path);
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = fs::remove_file(path.with_extension("sqlite-shm"));
}
