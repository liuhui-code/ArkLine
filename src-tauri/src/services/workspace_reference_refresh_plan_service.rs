use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::services::workspace_reference_member_index_service::contains_member_access;

const DEFAULT_MAX_SOURCE_BYTES: u64 = 512 * 1024;
const DEFAULT_MAX_TOTAL_SOURCE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshPathPlan {
    pub affected_paths: Vec<String>,
    pub affected_path_set: HashSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshContentBudget {
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshContentPlan {
    pub contents: HashMap<String, String>,
    pub skipped_oversized_paths: Vec<String>,
    pub member_context_required: bool,
}

pub(crate) fn plan_reference_refresh_paths(
    indexed_paths: &[String],
    removed_paths: &[String],
) -> ReferenceRefreshPathPlan {
    let mut affected_paths = indexed_paths
        .iter()
        .chain(removed_paths.iter())
        .map(|path| path.replace('/', "\\"))
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();
    let affected_path_set = affected_paths.iter().cloned().collect();
    ReferenceRefreshPathPlan {
        affected_paths,
        affected_path_set,
    }
}

pub(crate) fn plan_reference_refresh_content(file_paths: &[String]) -> ReferenceRefreshContentPlan {
    plan_reference_refresh_content_with_budget(file_paths, ReferenceRefreshContentBudget::default())
}

pub(crate) fn plan_reference_refresh_content_with_budget(
    file_paths: &[String],
    budget: ReferenceRefreshContentBudget,
) -> ReferenceRefreshContentPlan {
    let mut contents = HashMap::new();
    let mut skipped_oversized_paths = Vec::new();
    let mut total_bytes = 0_u64;
    for path in file_paths.iter().map(|path| path.replace('/', "\\")) {
        if !is_source_file(&path) {
            continue;
        }
        let filesystem_path = filesystem_path(&path);
        let Ok(metadata) = fs::metadata(&filesystem_path) else {
            continue;
        };
        let source_bytes = metadata.len();
        if source_bytes > budget.max_file_bytes
            || total_bytes.saturating_add(source_bytes) > budget.max_total_bytes
        {
            skipped_oversized_paths.push(path);
            continue;
        }
        let Ok(content) = fs::read_to_string(filesystem_path) else {
            continue;
        };
        total_bytes = total_bytes.saturating_add(source_bytes);
        contents.insert(path, content);
    }
    let member_context_required = contents
        .values()
        .any(|content| contains_member_access(content));
    ReferenceRefreshContentPlan {
        contents,
        skipped_oversized_paths,
        member_context_required,
    }
}

impl Default for ReferenceRefreshContentBudget {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_SOURCE_BYTES,
            max_total_bytes: DEFAULT_MAX_TOTAL_SOURCE_BYTES,
        }
    }
}

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

fn filesystem_path(path: &str) -> String {
    if Path::new(path).exists() {
        return path.to_string();
    }
    path.replace('\\', "/")
}
