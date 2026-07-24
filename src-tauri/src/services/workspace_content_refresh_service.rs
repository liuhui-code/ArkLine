use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Statement};
use serde::{Deserialize, Serialize};

use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_file_identity_service::ensure_workspace_file_id;
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_layer_generation_service::{
    publish_layer_generation, CONTENT_LAYER,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub(crate) const WORKSPACE_CONTENT_MAX_FILE_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const WORKSPACE_CONTENT_MAX_CHUNK_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceContentFile {
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) line_count: usize,
    pub(crate) source_bytes: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceContentFailure {
    pub(crate) path: String,
    pub(crate) error: String,
    pub(crate) resource_limited: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceContentRefresh {
    pub(crate) indexed_generation: u64,
    pub(crate) refreshed_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
    pub(crate) files: Vec<PreparedWorkspaceContentFile>,
    pub(crate) failures: Vec<PreparedWorkspaceContentFailure>,
    pub(crate) source_bytes: usize,
}

#[cfg(test)]
pub fn index_workspace_content(root_path: &str, indexed_paths: &[String]) -> Result<(), String> {
    index_workspace_content_at_generation(root_path, indexed_paths, now_epoch_ms()?)
}

pub(crate) fn index_workspace_content_at_generation(
    root_path: &str,
    indexed_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let root_key = normalize_index_path(root_path);
    let prepared =
        prepare_workspace_content_refresh(root_path, indexed_paths, &[], indexed_generation);
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        clear_workspace_content(&transaction, &root_key)?;
        publish_workspace_content_refresh(&transaction, &root_key, &prepared)?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

#[cfg(test)]
pub fn update_workspace_content(
    root_path: &str,
    added_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    update_workspace_content_at_generation(root_path, added_paths, removed_paths, now_epoch_ms()?)
}

pub(crate) fn update_workspace_content_at_generation(
    root_path: &str,
    added_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let root_key = normalize_index_path(root_path);
    let prepared = prepare_workspace_content_refresh(
        root_path,
        added_paths,
        removed_paths,
        indexed_generation,
    );
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        publish_workspace_content_refresh(&transaction, &root_key, &prepared)?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

pub(crate) fn prepare_workspace_content_refresh(
    root_path: &str,
    refreshed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> PreparedWorkspaceContentRefresh {
    prepare_workspace_content_refresh_with_limits(
        root_path,
        refreshed_paths,
        removed_paths,
        indexed_generation,
        WORKSPACE_CONTENT_MAX_FILE_BYTES,
        WORKSPACE_CONTENT_MAX_CHUNK_BYTES,
    )
}

pub(crate) fn prepare_workspace_content_refresh_with_limits(
    root_path: &str,
    refreshed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
    max_file_bytes: usize,
    max_chunk_bytes: usize,
) -> PreparedWorkspaceContentRefresh {
    let mut seen = HashSet::new();
    let mut normalized_refreshed_paths = Vec::new();
    let mut files = Vec::new();
    let mut failures = Vec::new();
    let mut source_bytes = 0usize;
    for path in refreshed_paths {
        let normalized_path = normalize_index_path(path);
        if !seen.insert(normalized_path.clone()) {
            continue;
        }
        normalized_refreshed_paths.push(normalized_path.clone());
        let file_path = to_filesystem_path(root_path, path);
        let remaining_bytes = max_chunk_bytes.saturating_sub(source_bytes);
        match read_bounded_content(&file_path, max_file_bytes, remaining_bytes) {
            Ok(content) => {
                let file_bytes = content.len();
                source_bytes = source_bytes.saturating_add(file_bytes);
                files.push(PreparedWorkspaceContentFile {
                    path: normalized_path,
                    line_count: content.lines().count(),
                    source_bytes: file_bytes,
                    content,
                });
            }
            Err((error, resource_limited)) => failures.push(PreparedWorkspaceContentFailure {
                path: normalized_path,
                error,
                resource_limited,
            }),
        }
    }
    PreparedWorkspaceContentRefresh {
        indexed_generation,
        refreshed_paths: normalized_refreshed_paths,
        removed_paths: normalized_unique_paths(removed_paths),
        files,
        failures,
        source_bytes,
    }
}

fn read_bounded_content(
    path: &str,
    max_file_bytes: usize,
    remaining_chunk_bytes: usize,
) -> Result<String, (String, bool)> {
    let metadata = fs::metadata(path).map_err(|error| {
        (
            format!("Source file metadata could not be read: {error}"),
            false,
        )
    })?;
    let source_size = usize::try_from(metadata.len()).unwrap_or(usize::MAX);
    if source_size > max_file_bytes {
        return Err((
            format!("Source file exceeds the {max_file_bytes} byte content-index limit"),
            true,
        ));
    }
    if source_size > remaining_chunk_bytes {
        return Err((
            format!(
                "Source file exceeds the remaining {remaining_chunk_bytes} byte content chunk budget"
            ),
            true,
        ));
    }
    let mut bytes = Vec::with_capacity(source_size.min(remaining_chunk_bytes));
    File::open(path)
        .map_err(|error| (format!("Source file could not be opened: {error}"), false))?
        .take(max_file_bytes.min(remaining_chunk_bytes).saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| (format!("Source file could not be read: {error}"), false))?;
    if bytes.len() > max_file_bytes || bytes.len() > remaining_chunk_bytes {
        return Err((
            "Source file changed while reading and exceeded the content-index byte budget"
                .to_string(),
            true,
        ));
    }
    String::from_utf8(bytes).map_err(|_| ("Source file is not valid UTF-8 text".to_string(), false))
}

pub(crate) fn publish_workspace_content_refresh(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<(), String> {
    publish_workspace_content_refresh_profiled(connection, root_key, prepared).map(|_| ())
}

pub(crate) fn publish_workspace_content_refresh_profiled(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("contentDelete", || {
        let candidates = prepared
            .removed_paths
            .iter()
            .chain(prepared.refreshed_paths.iter())
            .collect::<Vec<_>>();
        for path in existing_content_paths(connection, root_key, &candidates)? {
            delete_indexed_path(connection, root_key, path)?;
        }
        Ok(())
    })?;
    profiler.measure("contentInsert", || {
        insert_prepared_files(connection, root_key, &prepared.files)
    })?;
    profiler.measure("contentState", || {
        publish_content_file_states(connection, root_key, prepared)
    })?;
    profiler.measure("contentGeneration", || {
        publish_layer_generation(
            connection,
            root_key,
            CONTENT_LAYER,
            prepared.indexed_generation,
        )
    })?;
    Ok(profiler.finish())
}

fn clear_workspace_content(connection: &Connection, root_key: &str) -> Result<(), String> {
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_trigram_fts",
        "workspace_content_files",
    ] {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1"),
                params![root_key],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn delete_indexed_path(connection: &Connection, root_key: &str, path: &str) -> Result<(), String> {
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_trigram_fts",
        "workspace_content_files",
    ] {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1 and path = ?2"),
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn existing_content_paths<'a>(
    connection: &Connection,
    root_key: &str,
    candidates: &[&'a String],
) -> Result<Vec<&'a str>, String> {
    let mut statement = connection
        .prepare(
            "select exists(
                select 1 from workspace_content_files
                where root_path = ?1 and path = ?2
             )",
        )
        .map_err(|error| error.to_string())?;
    let mut existing = Vec::new();
    for path in candidates {
        let present = statement
            .query_row(params![root_key, path], |row| row.get::<_, bool>(0))
            .map_err(|error| error.to_string())?;
        if present {
            existing.push(path.as_str());
        }
    }
    Ok(existing)
}

fn insert_prepared_files(
    connection: &Connection,
    root_key: &str,
    files: &[PreparedWorkspaceContentFile],
) -> Result<(), String> {
    let mut line_statement = prepare_insert(connection, "workspace_content_lines")?;
    let mut fts_statement = prepare_insert(connection, "workspace_content_fts")?;
    let mut trigram_statement = prepare_insert(connection, "workspace_content_trigram_fts")?;
    for file in files {
        let file_id = ensure_workspace_file_id(connection, root_key, &file.path)?;
        for (line_index, line_text) in file.content.lines().enumerate() {
            insert_indexed_line(
                [
                    &mut line_statement,
                    &mut fts_statement,
                    &mut trigram_statement,
                ],
                root_key,
                &file.path,
                file_id,
                line_index,
                line_text,
            )?;
        }
    }
    Ok(())
}

fn publish_content_file_states(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<(), String> {
    let indexed_generation = i64::try_from(prepared.indexed_generation)
        .map_err(|_| "Content index generation exceeds SQLite integer range".to_string())?;
    for path in &prepared.refreshed_paths {
        let indexed = prepared.files.iter().find(|file| file.path == *path);
        let failure = prepared.failures.iter().find(|item| item.path == *path);
        let (status, line_count, error) = indexed.map_or_else(
            || {
                (
                    "failed",
                    0,
                    Some(
                        failure
                            .map(|item| item.error.as_str())
                            .unwrap_or("Source file could not be indexed"),
                    ),
                )
            },
            |file| ("ready", file.line_count as i64, None),
        );
        connection
            .execute(
                "insert into workspace_content_files (
                    root_path, path, indexed_generation, line_count, status, error, updated_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now') * 1000)
                 on conflict(root_path, path) do update set
                    indexed_generation = excluded.indexed_generation,
                    line_count = excluded.line_count,
                    status = excluded.status,
                    error = excluded.error,
                    updated_at = excluded.updated_at",
                params![
                    root_key,
                    path,
                    indexed_generation,
                    line_count,
                    status,
                    error
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn prepare_insert<'a>(connection: &'a Connection, table: &str) -> Result<Statement<'a>, String> {
    connection
        .prepare(&format!(
            "insert into {table} (root_path, path, file_id, line, text)
             values (?1, ?2, ?3, ?4, ?5)"
        ))
        .map_err(|error| error.to_string())
}

fn insert_indexed_line(
    statements: [&mut Statement<'_>; 3],
    root_key: &str,
    path: &str,
    file_id: i64,
    line_index: usize,
    line_text: &str,
) -> Result<(), String> {
    for statement in statements {
        statement
            .execute(params![
                root_key,
                path,
                file_id,
                (line_index + 1) as i64,
                line_text
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalized_unique_paths(paths: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .iter()
        .map(|path| normalize_index_path(path))
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        return indexed_path.to_string();
    }
    if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

#[cfg(test)]
fn now_epoch_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}
