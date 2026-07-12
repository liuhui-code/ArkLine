use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::models::workspace::WorkspaceSearchCandidate;

pub(crate) fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Err(format!(
            "Workspace index does not exist: {}",
            cache_path.display()
        ));
    }
    Connection::open(cache_path).map_err(|error| error.to_string())
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

pub(crate) fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub(crate) fn normalize_candidate_paths_for_filesystem(
    root_path: &str,
    candidates: &mut [WorkspaceSearchCandidate],
) {
    for candidate in candidates {
        if let Some(path) = candidate.path.as_mut() {
            *path = to_filesystem_path(root_path, path);
        }
    }
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        indexed_path.to_string()
    } else if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}
