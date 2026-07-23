use std::collections::HashMap;
#[cfg(not(test))]
use std::collections::HashSet;
use std::fs;
use std::path::Path;
#[cfg(not(test))]
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
#[cfg(not(test))]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};

use crate::services::workspace_shared_sdk_connection_service::{
    ensure_shared_sdk_store, shared_sdk_store_snapshot, with_shared_sdk_reader,
    with_shared_sdk_transaction, SharedSdkStoreSnapshot,
};
use crate::services::workspace_shared_sdk_schema_service::ensure_shared_sdk_schema;

const HOUR_MS: u128 = 60 * 60 * 1_000;
const DAY_MS: u128 = 24 * HOUR_MS;
const REFERENCE_REFRESH_MS: u128 = DAY_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SharedSdkRetentionPolicy {
    pub(crate) stale_building_ms: u128,
    pub(crate) stale_failed_ms: u128,
    pub(crate) unreferenced_ready_ms: u128,
    pub(crate) stale_reference_ms: u128,
    pub(crate) artifact_limit: usize,
}

impl Default for SharedSdkRetentionPolicy {
    fn default() -> Self {
        Self {
            stale_building_ms: DAY_MS,
            stale_failed_ms: 7 * DAY_MS,
            unreferenced_ready_ms: 30 * DAY_MS,
            stale_reference_ms: 90 * DAY_MS,
            artifact_limit: 8,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SharedSdkMaintenanceReport {
    pub(crate) deleted_artifact_count: usize,
    pub(crate) deleted_symbol_count: usize,
    pub(crate) deleted_reference_count: usize,
    pub(crate) remaining_artifact_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SharedSdkStoreStats {
    pub(crate) artifact_count: usize,
    pub(crate) ready_artifact_count: usize,
    pub(crate) building_artifact_count: usize,
    pub(crate) failed_artifact_count: usize,
    pub(crate) reference_count: usize,
    pub(crate) db_size_bytes: u64,
    pub(crate) wal_size_bytes: u64,
    pub(crate) freelist_bytes: u64,
    pub(crate) last_maintenance_at: Option<u128>,
    pub(crate) last_deleted_artifact_count: usize,
    pub(crate) store: SharedSdkStoreSnapshot,
}

pub(crate) fn record_shared_sdk_workspace_reference(
    store_path: &Path,
    workspace_root: &str,
    artifact_key: &str,
    now_ms: u128,
) -> Result<(), String> {
    ensure_shared_sdk_store(store_path, ensure_shared_sdk_schema)?;
    with_shared_sdk_transaction(store_path, |transaction| {
        transaction
            .execute(
                "insert into shared_sdk_workspace_references (
                    workspace_key, artifact_key, last_seen_at
                 ) values (?1, ?2, ?3)
                 on conflict(workspace_key) do update set
                    artifact_key = excluded.artifact_key,
                    last_seen_at = excluded.last_seen_at",
                params![
                    normalize_workspace_key(workspace_root),
                    artifact_key,
                    millis_i64(now_ms),
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn refresh_shared_sdk_workspace_reference_if_due(
    store_path: &Path,
    workspace_root: &str,
    artifact_key: &str,
) -> Result<(), String> {
    let now_ms = current_time_millis();
    let touch_key = format!(
        "{}\0{}",
        store_path.to_string_lossy(),
        normalize_workspace_key(workspace_root)
    );
    {
        let touches = reference_touches()
            .lock()
            .map_err(|_| "Shared SDK reference-touch registry poisoned".to_string())?;
        if touches
            .get(&touch_key)
            .is_some_and(|previous| now_ms.saturating_sub(*previous) < REFERENCE_REFRESH_MS)
        {
            return Ok(());
        }
    }
    record_shared_sdk_workspace_reference(store_path, workspace_root, artifact_key, now_ms)?;
    reference_touches()
        .lock()
        .map_err(|_| "Shared SDK reference-touch registry poisoned".to_string())?
        .insert(touch_key, now_ms);
    Ok(())
}

#[cfg(not(test))]
pub(crate) fn schedule_shared_sdk_maintenance(store_path: PathBuf) {
    let Ok(mut pending) = pending_maintenance().lock() else {
        return;
    };
    if !pending.insert(store_path.clone()) {
        return;
    }
    drop(pending);
    let _ = std::thread::Builder::new()
        .name("arkline-shared-sdk-maintenance".to_string())
        .spawn(move || {
            std::thread::sleep(Duration::from_secs(1));
            let _ = maintain_shared_sdk_store(
                &store_path,
                current_time_millis(),
                SharedSdkRetentionPolicy::default(),
            );
            if let Ok(mut pending) = pending_maintenance().lock() {
                pending.remove(&store_path);
            }
        });
}

pub(crate) fn maintain_shared_sdk_store(
    store_path: &Path,
    now_ms: u128,
    policy: SharedSdkRetentionPolicy,
) -> Result<SharedSdkMaintenanceReport, String> {
    ensure_shared_sdk_store(store_path, ensure_shared_sdk_schema)?;
    with_shared_sdk_transaction(store_path, |transaction| {
        let deleted_reference_count = transaction
            .execute(
                "delete from shared_sdk_workspace_references where last_seen_at < ?1",
                [millis_i64(now_ms.saturating_sub(policy.stale_reference_ms))],
            )
            .map_err(|error| error.to_string())?;
        let mut statement = transaction
            .prepare(
                "select artifact.artifact_key
                 from shared_sdk_artifacts artifact
                 where not exists (
                    select 1 from shared_sdk_workspace_references reference
                    where reference.artifact_key = artifact.artifact_key
                 ) and (
                    (artifact.status = 'building' and artifact.updated_at < ?1)
                    or (artifact.status = 'failed' and artifact.updated_at < ?2)
                    or (artifact.status = 'ready' and artifact.updated_at < ?3)
                 )
                 order by artifact.updated_at, artifact.artifact_key
                 limit ?4",
            )
            .map_err(|error| error.to_string())?;
        let artifact_keys = statement
            .query_map(
                params![
                    millis_i64(now_ms.saturating_sub(policy.stale_building_ms)),
                    millis_i64(now_ms.saturating_sub(policy.stale_failed_ms)),
                    millis_i64(now_ms.saturating_sub(policy.unreferenced_ready_ms)),
                    policy.artifact_limit as i64,
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        let mut deleted_symbol_count = 0;
        for artifact_key in &artifact_keys {
            deleted_symbol_count += transaction
                .query_row(
                    "select count(*) from shared_sdk_symbols where artifact_key = ?1",
                    [artifact_key],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())? as usize;
            delete_artifact(transaction, artifact_key)?;
        }
        transaction
            .execute(
                "insert into shared_sdk_maintenance_state (
                    singleton, last_run_at, deleted_artifact_count,
                    deleted_symbol_count, deleted_reference_count
                 ) values (1, ?1, ?2, ?3, ?4)
                 on conflict(singleton) do update set
                    last_run_at = excluded.last_run_at,
                    deleted_artifact_count = excluded.deleted_artifact_count,
                    deleted_symbol_count = excluded.deleted_symbol_count,
                    deleted_reference_count = excluded.deleted_reference_count",
                params![
                    millis_i64(now_ms),
                    artifact_keys.len() as i64,
                    deleted_symbol_count as i64,
                    deleted_reference_count as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        let remaining_artifact_count = transaction
            .query_row("select count(*) from shared_sdk_artifacts", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|error| error.to_string())? as usize;
        Ok(SharedSdkMaintenanceReport {
            deleted_artifact_count: artifact_keys.len(),
            deleted_symbol_count,
            deleted_reference_count,
            remaining_artifact_count,
        })
    })
}

pub(crate) fn inspect_shared_sdk_store(store_path: &Path) -> Result<SharedSdkStoreStats, String> {
    ensure_shared_sdk_store(store_path, ensure_shared_sdk_schema)?;
    let mut stats = with_shared_sdk_reader(store_path, |connection| {
        let counts = connection
            .query_row(
                "select count(*),
                        coalesce(sum(case when status = 'ready' then 1 else 0 end), 0),
                        coalesce(sum(case when status = 'building' then 1 else 0 end), 0),
                        coalesce(sum(case when status = 'failed' then 1 else 0 end), 0)
                 from shared_sdk_artifacts",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .map_err(|error| error.to_string())?;
        let reference_count = connection
            .query_row(
                "select count(*) from shared_sdk_workspace_references",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        let maintenance = connection
            .query_row(
                "select last_run_at, deleted_artifact_count
                 from shared_sdk_maintenance_state where singleton = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let page_size = pragma_u64(connection, "page_size")?;
        let freelist_pages = pragma_u64(connection, "freelist_count")?;
        Ok(SharedSdkStoreStats {
            artifact_count: counts.0 as usize,
            ready_artifact_count: counts.1 as usize,
            building_artifact_count: counts.2 as usize,
            failed_artifact_count: counts.3 as usize,
            reference_count: reference_count as usize,
            freelist_bytes: page_size.saturating_mul(freelist_pages),
            last_maintenance_at: maintenance.as_ref().map(|value| value.0 as u128),
            last_deleted_artifact_count: maintenance
                .as_ref()
                .map(|value| value.1 as usize)
                .unwrap_or_default(),
            ..SharedSdkStoreStats::default()
        })
    })?;
    stats.db_size_bytes = fs::metadata(store_path)
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    stats.wal_size_bytes = fs::metadata(sqlite_sidecar_path(store_path, "-wal"))
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    stats.store = shared_sdk_store_snapshot(store_path);
    Ok(stats)
}

fn pragma_u64(connection: &rusqlite::Connection, name: &str) -> Result<u64, String> {
    connection
        .query_row(&format!("pragma {name}"), [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn sqlite_sidecar_path(store_path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut value = store_path.as_os_str().to_os_string();
    value.push(suffix);
    value.into()
}

fn delete_artifact(
    transaction: &rusqlite::Transaction<'_>,
    artifact_key: &str,
) -> Result<(), String> {
    for table in [
        "shared_sdk_symbol_trigrams",
        "shared_sdk_symbols",
        "shared_sdk_artifacts",
    ] {
        transaction
            .execute(
                &format!("delete from {table} where artifact_key = ?1"),
                [artifact_key],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalize_workspace_key(root_path: &str) -> String {
    root_path.replace('\\', "/")
}

fn millis_i64(value: u128) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn current_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn reference_touches() -> &'static Mutex<HashMap<String, u128>> {
    static TOUCHES: OnceLock<Mutex<HashMap<String, u128>>> = OnceLock::new();
    TOUCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(test))]
fn pending_maintenance() -> &'static Mutex<HashSet<PathBuf>> {
    static PENDING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashSet::new()))
}
