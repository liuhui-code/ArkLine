use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;
pub(crate) use crate::services::workspace_content_publication_service::existing_content_paths;
use crate::services::workspace_content_publication_service::{
    clear_workspace_content, publish_content_core_profiled, publish_content_substring_profiled,
};
use crate::services::workspace_file_index_policy_service::{
    classify_workspace_file, WorkspaceFileLayerPolicy, WORKSPACE_FULL_CONTENT_MAX_BYTES,
};
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub(crate) const WORKSPACE_CONTENT_MAX_FILE_BYTES: usize = WORKSPACE_FULL_CONTENT_MAX_BYTES;
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
pub(crate) struct PreparedWorkspaceContentSkip {
    pub(crate) path: String,
    pub(crate) index_class: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceContentRefresh {
    pub(crate) indexed_generation: u64,
    pub(crate) refreshed_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
    pub(crate) files: Vec<PreparedWorkspaceContentFile>,
    pub(crate) skips: Vec<PreparedWorkspaceContentSkip>,
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
    let mut skips = Vec::new();
    let mut failures = Vec::new();
    let mut source_bytes = 0usize;
    for path in refreshed_paths {
        let normalized_path = normalize_index_path(path);
        if !seen.insert(normalized_path.clone()) {
            continue;
        }
        normalized_refreshed_paths.push(normalized_path.clone());
        let file_path = to_filesystem_path(root_path, path);
        match classify_workspace_file(Path::new(root_path), Path::new(&file_path), max_file_bytes) {
            Ok(policy) if policy.content == WorkspaceFileLayerPolicy::Skip => {
                skips.push(PreparedWorkspaceContentSkip {
                    path: normalized_path,
                    index_class: policy.class.as_str().to_string(),
                    reason: policy.reason,
                });
                continue;
            }
            Err(error) => {
                failures.push(PreparedWorkspaceContentFailure {
                    path: normalized_path,
                    error: format!("Source file policy could not be determined: {error}"),
                    resource_limited: false,
                });
                continue;
            }
            Ok(_) => {}
        }
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
        skips,
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
    let mut profile = publish_content_core_profiled(connection, root_key, prepared)?;
    let substring = publish_content_substring_profiled(connection, root_key, prepared)?;
    profile.total_duration_us = profile
        .total_duration_us
        .saturating_add(substring.total_duration_us);
    profile.stages.extend(substring.stages);
    Ok(profile)
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
