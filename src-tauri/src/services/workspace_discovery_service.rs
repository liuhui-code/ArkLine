use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::services::workspace_service::{normalize_path, should_exclude};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkspaceDiscoveryCursor {
    pub pending_directories: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkspaceDiscoveredFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkspaceDiscoveryChunk {
    pub files: Vec<WorkspaceDiscoveredFile>,
    pub cursor: Option<WorkspaceDiscoveryCursor>,
    pub excluded_count: usize,
    pub has_more: bool,
}

pub fn discover_workspace_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
) -> Result<WorkspaceDiscoveryChunk, String> {
    validate_root(root_path)?;
    if limit == 0 {
        return Err("Workspace discovery limit must be greater than zero".to_string());
    }

    let mut queue = discovery_queue(root_path, cursor);
    let mut files = Vec::new();
    let mut excluded_count = 0;

    while let Some(path) = queue.pop_front() {
        if path != root_path && should_exclude(root_path, &path) {
            excluded_count += 1;
            continue;
        }

        if path.is_dir() {
            for child in sorted_children(&path)? {
                queue.push_back(child);
            }
            continue;
        }

        if path.is_file() {
            files.push(discovered_file(&path)?);
            if files.len() >= limit {
                break;
            }
        }
    }

    let cursor = if queue.is_empty() {
        None
    } else {
        Some(WorkspaceDiscoveryCursor {
            pending_directories: queue.iter().map(|path| normalize_path(path)).collect(),
        })
    };

    Ok(WorkspaceDiscoveryChunk {
        files,
        has_more: cursor.is_some(),
        cursor,
        excluded_count,
    })
}

fn discovery_queue(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
) -> VecDeque<PathBuf> {
    cursor
        .map(|cursor| {
            cursor
                .pending_directories
                .into_iter()
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_else(|| VecDeque::from([root_path.to_path_buf()]))
}

fn sorted_children(directory_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut children = fs::read_dir(directory_path)
        .map_err(|error| error.to_string())?
        .map(|entry| {
            entry
                .map(|entry| entry.path())
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    children.sort_by_key(|path| normalize_path(path));
    Ok(children)
}

fn discovered_file(path: &Path) -> Result<WorkspaceDiscoveredFile, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(WorkspaceDiscoveredFile {
        path: normalize_path(path),
        size_bytes: metadata.len(),
        modified_ms: metadata.modified().ok().and_then(|modified| {
            modified
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis() as u64)
        }),
    })
}

fn validate_root(root_path: &Path) -> Result<(), String> {
    if !root_path.exists() {
        return Err(format!(
            "Workspace path does not exist: {}",
            root_path.display()
        ));
    }

    if !root_path.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {}",
            root_path.display()
        ));
    }

    Ok(())
}
