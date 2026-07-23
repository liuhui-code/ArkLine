use std::path::Path;

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_index_connection_service::{
    require_existing_workspace_index_reader, WorkspaceIndexReader,
};

pub(crate) fn open_index_store(root_path: &str) -> Result<WorkspaceIndexReader<'static>, String> {
    require_existing_workspace_index_reader(root_path)
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

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        indexed_path.to_string()
    } else if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}
