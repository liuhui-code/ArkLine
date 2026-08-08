use std::collections::{hash_map::DefaultHasher, HashMap};
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use rusqlite::{params, OptionalExtension, Statement};

use crate::services::workspace_file_index_policy_service::{
    classify_workspace_file, WorkspaceFileIndexPolicy, WorkspaceFileLayerPolicy,
    WORKSPACE_FULL_CONTENT_MAX_BYTES,
};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;

const CONTENT_INDEX_VERSION: i64 = 1;
const SYMBOL_INDEX_VERSION: i64 = 1;
const FINGERPRINT_SAMPLE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceFileFingerprintStatus {
    Changed,
    Unchanged,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceFileFingerprintChange {
    pub path: String,
    pub status: WorkspaceFileFingerprintStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CurrentFileFingerprint {
    mtime_ms: i64,
    size: i64,
    hash: String,
    policy: WorkspaceFileIndexPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StoredFileFingerprint {
    mtime_ms: i64,
    size: i64,
    hash: String,
    content_index_version: i64,
    symbol_index_version: i64,
    stub_parser_version: i64,
    substring_index_ready: bool,
    index_class: String,
    content_policy: String,
    symbol_policy: String,
}

pub fn classify_file_fingerprints(
    root_path: &str,
    paths: &[String],
) -> Result<Vec<WorkspaceFileFingerprintChange>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }

    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return classify_without_stored_fingerprints(root_path, paths);
    };
    let root_key = normalize_index_path(root_path);
    let mut changes = Vec::new();
    let mut select_statement = connection
        .prepare(
            "select fingerprint.mtime_ms, fingerprint.size, fingerprint.hash,
                fingerprint.content_index_version, fingerprint.symbol_index_version,
                fingerprint.stub_parser_version,
                case when fingerprint.content_policy = 'skip' then 1 when exists(
                    select 1 from workspace_content_files core
                    where core.root_path = fingerprint.root_path
                      and core.path = fingerprint.path
                ) then exists(
                    select 1 from workspace_content_files core
                    join workspace_content_substring_files substring
                      on substring.root_path = core.root_path and substring.path = core.path
                    where core.root_path = fingerprint.root_path
                      and core.path = fingerprint.path
                      and substring.status = 'ready'
                      and substring.indexed_generation = core.indexed_generation
                ) else 1 end,
                fingerprint.index_class, fingerprint.content_policy, fingerprint.symbol_policy
             from workspace_file_fingerprints fingerprint
             where fingerprint.root_path = ?1 and fingerprint.path = ?2",
        )
        .map_err(|error| error.to_string())?;

    for path in paths {
        let Some(current) = current_file_fingerprint(root_path, path)? else {
            changes.push(WorkspaceFileFingerprintChange {
                path: path.clone(),
                status: WorkspaceFileFingerprintStatus::Deleted,
            });
            continue;
        };
        let stored = load_stored_fingerprint(&mut select_statement, &root_key, path)?;
        let status = if stored.is_some_and(|stored| fingerprint_matches(&stored, &current)) {
            WorkspaceFileFingerprintStatus::Unchanged
        } else {
            WorkspaceFileFingerprintStatus::Changed
        };
        changes.push(WorkspaceFileFingerprintChange {
            path: path.clone(),
            status,
        });
    }

    Ok(changes)
}

pub fn update_file_fingerprints(
    root_path: &str,
    paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    update_fingerprints(root_path, paths, indexed_generation, true)
}

pub fn update_file_catalog_fingerprints(
    root_path: &str,
    paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    update_fingerprints(root_path, paths, indexed_generation, false)
}

fn update_fingerprints(
    root_path: &str,
    paths: &[String],
    indexed_generation: u64,
    layers_ready: bool,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let root_key = normalize_index_path(root_path);
    let result =
        with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
            let version = i64::from(layers_ready);
            let mut insert_statement = transaction
                .prepare(
                    "insert into workspace_file_fingerprints (
                root_path, path, mtime_ms, size, hash,
                content_index_version, symbol_index_version, stub_parser_version,
                indexed_generation, index_class, content_policy, symbol_policy, policy_reason
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             on conflict(root_path, path) do update set
                mtime_ms = excluded.mtime_ms,
                size = excluded.size,
                hash = excluded.hash,
                content_index_version = case
                    when ?14 = 1 then excluded.content_index_version
                    when workspace_file_fingerprints.mtime_ms = excluded.mtime_ms
                        and workspace_file_fingerprints.size = excluded.size
                        and workspace_file_fingerprints.hash = excluded.hash
                    then workspace_file_fingerprints.content_index_version else 0 end,
                symbol_index_version = case
                    when ?14 = 1 then excluded.symbol_index_version
                    when workspace_file_fingerprints.mtime_ms = excluded.mtime_ms
                        and workspace_file_fingerprints.size = excluded.size
                        and workspace_file_fingerprints.hash = excluded.hash
                    then workspace_file_fingerprints.symbol_index_version else 0 end,
                stub_parser_version = case
                    when ?14 = 1 then excluded.stub_parser_version
                    when workspace_file_fingerprints.mtime_ms = excluded.mtime_ms
                        and workspace_file_fingerprints.size = excluded.size
                        and workspace_file_fingerprints.hash = excluded.hash
                    then workspace_file_fingerprints.stub_parser_version else 0 end,
                indexed_generation = excluded.indexed_generation,
                index_class = excluded.index_class,
                content_policy = excluded.content_policy,
                symbol_policy = excluded.symbol_policy,
                policy_reason = excluded.policy_reason",
                )
                .map_err(|error| error.to_string())?;
            for path in paths {
                let Some(current) = current_file_fingerprint(root_path, path)? else {
                    continue;
                };
                let normalized_path = normalize_index_path(path);
                insert_statement
                    .execute(params![
                        &root_key,
                        normalized_path,
                        current.mtime_ms,
                        current.size,
                        current.hash,
                        if layers_ready {
                            CONTENT_INDEX_VERSION
                        } else {
                            0
                        },
                        if layers_ready {
                            SYMBOL_INDEX_VERSION
                        } else {
                            0
                        },
                        if layers_ready {
                            ARKTS_STUB_PARSER_VERSION
                        } else {
                            0
                        },
                        indexed_generation as i64,
                        current.policy.class.as_str(),
                        current.policy.content.as_str(),
                        current.policy.symbols.as_str(),
                        current.policy.reason,
                        version,
                    ])
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        });
    if result.is_ok() && !paths.is_empty() {
        bump_workspace_file_policy_revision(root_path);
    }
    result
}

pub fn remove_file_fingerprints(root_path: &str, paths: &[String]) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let root_key = normalize_index_path(root_path);
    let result =
        with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
            let mut delete_statement = transaction
                .prepare(
                    "delete from workspace_file_fingerprints
             where root_path = ?1 and path = ?2",
                )
                .map_err(|error| error.to_string())?;
            for path in paths {
                let normalized_path = normalize_index_path(path);
                delete_statement
                    .execute(params![&root_key, normalized_path])
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        });
    if result.is_ok() && !paths.is_empty() {
        bump_workspace_file_policy_revision(root_path);
    }
    result
}

pub(crate) fn workspace_file_policy_revision(root_path: &str) -> u64 {
    policy_revisions()
        .lock()
        .ok()
        .and_then(|revisions| revisions.get(&normalize_index_path(root_path)).copied())
        .unwrap_or(0)
}

fn bump_workspace_file_policy_revision(root_path: &str) {
    let Ok(mut revisions) = policy_revisions().lock() else {
        return;
    };
    let revision = revisions
        .entry(normalize_index_path(root_path))
        .or_default();
    *revision = revision.saturating_add(1);
}

fn policy_revisions() -> &'static Mutex<HashMap<String, u64>> {
    static REVISIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    REVISIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn classify_without_stored_fingerprints(
    root_path: &str,
    paths: &[String],
) -> Result<Vec<WorkspaceFileFingerprintChange>, String> {
    paths
        .iter()
        .map(|path| {
            Ok(WorkspaceFileFingerprintChange {
                path: path.clone(),
                status: if current_file_fingerprint(root_path, path)?.is_some() {
                    WorkspaceFileFingerprintStatus::Changed
                } else {
                    WorkspaceFileFingerprintStatus::Deleted
                },
            })
        })
        .collect()
}

fn fingerprint_matches(stored: &StoredFileFingerprint, current: &CurrentFileFingerprint) -> bool {
    stored.mtime_ms == current.mtime_ms
        && stored.size == current.size
        && stored.hash == current.hash
        && stored.content_index_version == CONTENT_INDEX_VERSION
        && stored.symbol_index_version == SYMBOL_INDEX_VERSION
        && stored.stub_parser_version == ARKTS_STUB_PARSER_VERSION
        && stored.substring_index_ready
        && stored.index_class == current.policy.class.as_str()
        && stored.content_policy == current.policy.content.as_str()
        && stored.symbol_policy == current.policy.symbols.as_str()
}

fn load_stored_fingerprint(
    statement: &mut Statement<'_>,
    root_key: &str,
    path: &str,
) -> Result<Option<StoredFileFingerprint>, String> {
    let normalized_path = normalize_index_path(path);
    statement
        .query_row(params![root_key, normalized_path], |row| {
            Ok(StoredFileFingerprint {
                mtime_ms: row.get(0)?,
                size: row.get(1)?,
                hash: row.get(2)?,
                content_index_version: row.get(3)?,
                symbol_index_version: row.get(4)?,
                stub_parser_version: row.get(5)?,
                substring_index_ready: row.get(6)?,
                index_class: row.get(7)?,
                content_policy: row.get(8)?,
                symbol_policy: row.get(9)?,
            })
        })
        .optional()
        .map_err(|error| error.to_string())
}

fn current_file_fingerprint(
    root_path: &str,
    path: &str,
) -> Result<Option<CurrentFileFingerprint>, String> {
    let file_path = filesystem_path(path);
    if !file_path.is_file() {
        return Ok(None);
    }

    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let policy = classify_workspace_file(
        Path::new(root_path),
        &file_path,
        WORKSPACE_FULL_CONTENT_MAX_BYTES,
    )?;
    let hash = hash_file_bounded(&file_path, metadata.len(), policy.content)?;
    Ok(Some(CurrentFileFingerprint {
        mtime_ms: modified,
        size: metadata.len() as i64,
        hash,
        policy,
    }))
}

fn hash_file_bounded(
    path: &Path,
    size: u64,
    content_policy: WorkspaceFileLayerPolicy,
) -> Result<String, String> {
    let mut hasher = DefaultHasher::new();
    size.hash(&mut hasher);
    if content_policy == WorkspaceFileLayerPolicy::Index {
        fs::read(path)
            .map_err(|error| error.to_string())?
            .hash(&mut hasher);
        return Ok(format!("{:016x}", hasher.finish()));
    }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut first = vec![0; FINGERPRINT_SAMPLE_BYTES.min(size as usize)];
    file.read_exact(&mut first)
        .map_err(|error| error.to_string())?;
    first.hash(&mut hasher);
    if size > FINGERPRINT_SAMPLE_BYTES as u64 {
        let tail_size = FINGERPRINT_SAMPLE_BYTES.min(size as usize);
        file.seek(SeekFrom::End(-(tail_size as i64)))
            .map_err(|error| error.to_string())?;
        let mut tail = vec![0; tail_size];
        file.read_exact(&mut tail)
            .map_err(|error| error.to_string())?;
        tail.hash(&mut hasher);
    }
    Ok(format!("{:016x}", hasher.finish()))
}

fn filesystem_path(path: &str) -> PathBuf {
    if Path::new(path).exists() {
        return PathBuf::from(path);
    }
    PathBuf::from(path.replace('\\', "/"))
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
