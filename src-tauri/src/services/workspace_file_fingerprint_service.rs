use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection, OptionalExtension, Statement};

use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;

const CONTENT_INDEX_VERSION: i64 = 1;
const SYMBOL_INDEX_VERSION: i64 = 1;

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StoredFileFingerprint {
    mtime_ms: i64,
    size: i64,
    hash: String,
    content_index_version: i64,
    symbol_index_version: i64,
    stub_parser_version: i64,
}

pub fn classify_file_fingerprints(
    root_path: &str,
    paths: &[String],
) -> Result<Vec<WorkspaceFileFingerprintChange>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }

    let connection = open_fingerprint_store(root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let mut changes = Vec::new();
    let mut select_statement = connection
        .prepare(
            "select mtime_ms, size, hash, content_index_version, symbol_index_version,
                stub_parser_version
             from workspace_file_fingerprints
             where root_path = ?1 and path = ?2",
        )
        .map_err(|error| error.to_string())?;

    for path in paths {
        let Some(current) = current_file_fingerprint(path)? else {
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
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let mut connection = open_fingerprint_store(root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut insert_statement = transaction
        .prepare(
            "insert into workspace_file_fingerprints (
                root_path, path, mtime_ms, size, hash,
                content_index_version, symbol_index_version, stub_parser_version,
                indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             on conflict(root_path, path) do update set
                mtime_ms = excluded.mtime_ms,
                size = excluded.size,
                hash = excluded.hash,
                content_index_version = excluded.content_index_version,
                symbol_index_version = excluded.symbol_index_version,
                stub_parser_version = excluded.stub_parser_version,
                indexed_generation = excluded.indexed_generation",
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        let Some(current) = current_file_fingerprint(path)? else {
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
                CONTENT_INDEX_VERSION,
                SYMBOL_INDEX_VERSION,
                ARKTS_STUB_PARSER_VERSION,
                indexed_generation as i64,
            ])
            .map_err(|error| error.to_string())?;
    }
    drop(insert_statement);
    transaction.commit().map_err(|error| error.to_string())
}

pub fn remove_file_fingerprints(root_path: &str, paths: &[String]) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let mut connection = open_fingerprint_store(root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
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
    drop(delete_statement);
    transaction.commit().map_err(|error| error.to_string())
}

fn fingerprint_matches(stored: &StoredFileFingerprint, current: &CurrentFileFingerprint) -> bool {
    stored.mtime_ms == current.mtime_ms
        && stored.size == current.size
        && stored.hash == current.hash
        && stored.content_index_version == CONTENT_INDEX_VERSION
        && stored.symbol_index_version == SYMBOL_INDEX_VERSION
        && stored.stub_parser_version == ARKTS_STUB_PARSER_VERSION
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
            })
        })
        .optional()
        .map_err(|error| error.to_string())
}

fn current_file_fingerprint(path: &str) -> Result<Option<CurrentFileFingerprint>, String> {
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
    let bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(Some(CurrentFileFingerprint {
        mtime_ms: modified,
        size: metadata.len() as i64,
        hash: format!("{:016x}", hasher.finish()),
    }))
}

fn open_fingerprint_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace fingerprint index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(&cache_path).map_err(|error| error.to_string())
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    ensure_workspace_index_schema(connection)
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
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
