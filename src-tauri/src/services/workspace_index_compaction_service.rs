use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;
use crate::services::workspace_index_store_generation_service::{
    with_exclusive_workspace_index_store_swap, workspace_index_store_generation,
    WorkspaceIndexStoreSwapOutcome,
};

const COMPACTION_POLL_INTERVAL: Duration = Duration::from_millis(25);
const COMPACTION_PROGRESS_OPS: i32 = 10_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceIndexStoreFingerprint {
    db_size_bytes: u64,
    db_modified_ns: u64,
    wal_size_bytes: u64,
    wal_modified_ns: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceIndexCompactionCandidate {
    pub(crate) path: String,
    pub(crate) expected_revision: u64,
    pub(crate) source_fingerprint: WorkspaceIndexStoreFingerprint,
    pub(crate) source_size_bytes: u64,
    pub(crate) candidate_size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexCompactionCommit {
    Applied {
        reclaimed_bytes: u64,
        generation: u64,
    },
    DeferredSourceChanged,
    DeferredReadersActive,
    DeferredStoreBusy,
}

pub(crate) fn prepare_workspace_index_compaction(
    root_path: &str,
    mut should_yield: impl FnMut() -> bool,
) -> Result<Option<WorkspaceIndexCompactionCandidate>, String> {
    if should_yield() {
        return Ok(None);
    }
    let store_path = sqlite_catalog_cache_path(root_path);
    if !store_path.is_file() {
        return Ok(None);
    }
    let expected_revision = workspace_index_store_generation(&store_path).revision;
    let candidate_path = compaction_candidate_path(root_path)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = Arc::clone(&cancelled);
    let worker_store = store_path.clone();
    let worker_candidate = candidate_path.clone();
    let (result_tx, result_rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("arkline-index-compaction".to_string())
        .spawn(move || {
            let result =
                build_compaction_candidate(&worker_store, &worker_candidate, worker_cancelled);
            let _ = result_tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    let build_result = loop {
        match result_rx.recv_timeout(COMPACTION_POLL_INTERVAL) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) if should_yield() => {
                cancelled.store(true, Ordering::SeqCst);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err("Workspace index compaction worker disconnected".to_string());
            }
        }
    };
    let build = match build_result {
        Ok(build) => build,
        Err(error) => {
            remove_candidate(&candidate_path);
            if cancelled.load(Ordering::SeqCst) && error.contains("interrupted") {
                return Ok(None);
            }
            return Err(error);
        }
    };
    if cancelled.load(Ordering::SeqCst)
        || build.source_changed
        || workspace_index_store_generation(&store_path).revision != expected_revision
        || store_fingerprint(&store_path)? != build.source_fingerprint
    {
        remove_candidate(&candidate_path);
        return Ok(None);
    }
    validate_compaction_candidate(&candidate_path)?;
    let candidate_size_bytes = file_state(&candidate_path)?.0;
    Ok(Some(WorkspaceIndexCompactionCandidate {
        path: candidate_path.to_string_lossy().to_string(),
        expected_revision,
        source_fingerprint: build.source_fingerprint,
        source_size_bytes: build.source_fingerprint.db_size_bytes,
        candidate_size_bytes,
    }))
}

pub(crate) fn commit_workspace_index_compaction(
    store_path: &Path,
    candidate: &WorkspaceIndexCompactionCandidate,
) -> Result<WorkspaceIndexCompactionCommit, String> {
    let candidate_path = PathBuf::from(&candidate.path);
    validate_candidate_location(store_path, &candidate_path)?;
    validate_compaction_candidate(&candidate_path)?;
    let swap =
        with_exclusive_workspace_index_store_swap(store_path, candidate.expected_revision, || {
            if store_fingerprint(store_path)? != candidate.source_fingerprint {
                return Ok(None);
            }
            if !checkpoint_workspace_index_store(store_path)? {
                return Ok(None);
            }
            replace_store_file(store_path, &candidate_path)?;
            Ok(Some(
                candidate
                    .source_size_bytes
                    .saturating_sub(candidate.candidate_size_bytes),
            ))
        })?;
    match swap {
        WorkspaceIndexStoreSwapOutcome::Applied {
            value: Some(reclaimed_bytes),
            generation,
        } => Ok(WorkspaceIndexCompactionCommit::Applied {
            reclaimed_bytes,
            generation,
        }),
        WorkspaceIndexStoreSwapOutcome::Applied { value: None, .. } => {
            Ok(WorkspaceIndexCompactionCommit::DeferredStoreBusy)
        }
        WorkspaceIndexStoreSwapOutcome::StaleRevision => {
            Ok(WorkspaceIndexCompactionCommit::DeferredSourceChanged)
        }
        WorkspaceIndexStoreSwapOutcome::ReadersActive => {
            Ok(WorkspaceIndexCompactionCommit::DeferredReadersActive)
        }
    }
}

pub(crate) fn remove_workspace_index_compaction_candidate(
    candidate: &WorkspaceIndexCompactionCandidate,
) {
    remove_candidate(Path::new(&candidate.path));
}

fn build_compaction_candidate(
    store_path: &Path,
    candidate_path: &Path,
    cancelled: Arc<AtomicBool>,
) -> Result<CompactionBuildResult, String> {
    remove_candidate(candidate_path);
    let connection = Connection::open_with_flags(store_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    connection.progress_handler(
        COMPACTION_PROGRESS_OPS,
        Some(move || cancelled.load(Ordering::Relaxed)),
    );
    let data_version_before = pragma_data_version(&connection)?;
    connection
        .execute("vacuum into ?1", params![candidate_path.to_string_lossy()])
        .map_err(|error| error.to_string())?;
    let data_version_after = pragma_data_version(&connection)?;
    connection.progress_handler(0, None::<fn() -> bool>);
    drop(connection);
    Ok(CompactionBuildResult {
        source_changed: data_version_before != data_version_after,
        source_fingerprint: store_fingerprint(store_path)?,
    })
}

#[derive(Debug, Clone, Copy)]
struct CompactionBuildResult {
    source_changed: bool,
    source_fingerprint: WorkspaceIndexStoreFingerprint,
}

fn pragma_data_version(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("pragma data_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn validate_compaction_candidate(candidate_path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        candidate_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())?;
    let integrity: String = connection
        .query_row("pragma integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!(
            "Workspace index compaction candidate failed integrity check: {integrity}"
        ));
    }
    let table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_schema
             where type = 'table'
               and name in ('workspace_catalog', 'workspace_index_schema_versions')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let schema_version_count: i64 = connection
        .query_row(
            "select count(*) from workspace_index_schema_versions",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if table_count != 2 || schema_version_count == 0 {
        return Err("Workspace index compaction candidate missed required schema".to_string());
    }
    Ok(())
}

fn validate_candidate_location(store_path: &Path, candidate_path: &Path) -> Result<(), String> {
    let expected_parent = store_path
        .parent()
        .ok_or_else(|| "Workspace index store has no parent".to_string())?
        .join("staging");
    let name = candidate_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if candidate_path.parent() != Some(expected_parent.as_path())
        || !name.starts_with("compaction-")
        || !name.ends_with(".sqlite")
    {
        return Err("Workspace index compaction candidate escaped staging".to_string());
    }
    Ok(())
}

pub(crate) fn checkpoint_workspace_index_store(store_path: &Path) -> Result<bool, String> {
    let connection = Connection::open(store_path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_millis(100))
        .map_err(|error| error.to_string())?;
    let (busy, _, _): (i64, i64, i64) = connection
        .query_row("pragma wal_checkpoint(truncate)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| error.to_string())?;
    Ok(busy == 0)
}

fn store_fingerprint(store_path: &Path) -> Result<WorkspaceIndexStoreFingerprint, String> {
    let (db_size_bytes, db_modified_ns) = file_state(store_path)?;
    let (wal_size_bytes, wal_modified_ns) = optional_file_state(&sidecar_path(store_path, "-wal"))?;
    Ok(WorkspaceIndexStoreFingerprint {
        db_size_bytes,
        db_modified_ns,
        wal_size_bytes,
        wal_modified_ns,
    })
}

fn file_state(path: &Path) -> Result<(u64, u64), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let modified = u64::try_from(modified)
        .map_err(|_| "Workspace index file timestamp exceeded u64 nanoseconds".to_string())?;
    Ok((metadata.len(), modified))
}

fn optional_file_state(path: &Path) -> Result<(u64, u64), String> {
    match fs::metadata(path) {
        Ok(_) => file_state(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((0, 0)),
        Err(error) => Err(error.to_string()),
    }
}

fn compaction_candidate_path(root_path: &str) -> Result<PathBuf, String> {
    let staging = Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("staging");
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    Ok(staging.join(format!("compaction-{}.sqlite", uuid::Uuid::new_v4())))
}

fn sidecar_path(store_path: &Path, suffix: &str) -> PathBuf {
    let mut path = store_path.as_os_str().to_os_string();
    path.push(suffix);
    path.into()
}

fn remove_candidate(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(not(windows))]
fn replace_store_file(store_path: &Path, candidate_path: &Path) -> Result<(), String> {
    fs::rename(candidate_path, store_path).map_err(|error| error.to_string())?;
    sync_parent(store_path)
}

#[cfg(windows)]
fn replace_store_file(store_path: &Path, candidate_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let replaced = store_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = candidate_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    (result != 0)
        .then_some(())
        .ok_or_else(|| std::io::Error::last_os_error().to_string())
}

#[cfg(not(windows))]
fn sync_parent(store_path: &Path) -> Result<(), String> {
    let parent = store_path
        .parent()
        .ok_or_else(|| "Workspace index store has no parent".to_string())?;
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "workspace_index_compaction_service_tests.rs"]
mod tests;
