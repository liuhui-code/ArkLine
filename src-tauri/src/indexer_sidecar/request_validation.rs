use std::collections::HashSet;

use super::protocol::{
    IndexerContentRefreshRequest, IndexerStubRefreshRequest, INDEXER_CONTENT_REFRESH_PATH_LIMIT,
    INDEXER_STUB_REFRESH_PATH_LIMIT,
};

const INDEXER_PATH_BYTE_LIMIT: usize = 4096;

pub(super) fn validate_stub_refresh_request(
    request: &IndexerStubRefreshRequest,
) -> Result<(), String> {
    validate_refresh_request(
        &request.task.root_path,
        &request.task.kind,
        request.task.generation,
        request.indexed_generation,
        &request.priority,
        &request.changed_paths,
        &request.removed_paths,
        "stub-refresh",
        "Stub refresh",
        INDEXER_STUB_REFRESH_PATH_LIMIT,
    )
}

pub(super) fn validate_content_refresh_request(
    request: &IndexerContentRefreshRequest,
) -> Result<(), String> {
    validate_refresh_request(
        &request.task.root_path,
        &request.task.kind,
        request.task.generation,
        request.indexed_generation,
        &request.priority,
        &request.changed_paths,
        &request.removed_paths,
        "content-refresh",
        "Content refresh",
        INDEXER_CONTENT_REFRESH_PATH_LIMIT,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_refresh_request(
    root_path: &str,
    task_kind: &str,
    task_generation: u64,
    indexed_generation: u64,
    priority: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    expected_kind: &str,
    label: &str,
    path_limit: usize,
) -> Result<(), String> {
    if task_kind != expected_kind {
        return Err(format!("{label} task kind must be {expected_kind}"));
    }
    if task_generation == 0 || indexed_generation == 0 {
        return Err(format!("{label} generations must be positive"));
    }
    if priority != "background" {
        return Err(format!(
            "{label} sidecar currently accepts background priority only"
        ));
    }
    let path_count = changed_paths.len() + removed_paths.len();
    if !(1..=path_limit).contains(&path_count) {
        return Err(format!(
            "{label} must contain between 1 and {path_limit} paths"
        ));
    }
    let mut unique_paths = HashSet::with_capacity(path_count);
    for path in changed_paths.iter().chain(removed_paths.iter()) {
        if path.is_empty() || path.len() > INDEXER_PATH_BYTE_LIMIT {
            return Err(format!(
                "{label} path is empty or exceeds {INDEXER_PATH_BYTE_LIMIT} bytes"
            ));
        }
        if !path_belongs_to_root(root_path, path) {
            return Err(format!("{label} path is outside workspace root: {path}"));
        }
        if !unique_paths.insert(comparable_path(path)) {
            return Err(format!("{label} contains a duplicate path: {path}"));
        }
    }
    Ok(())
}

fn path_belongs_to_root(root_path: &str, path: &str) -> bool {
    let root = comparable_path(root_path).trim_end_matches('/').to_string();
    let path = comparable_path(path);
    path == root || path.starts_with(&format!("{root}/"))
}

fn comparable_path(path: &str) -> String {
    let path = lexical_path(&path.replace('\\', "/"));
    if cfg!(windows) {
        path.to_ascii_lowercase()
    } else {
        path
    }
}

fn lexical_path(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}
