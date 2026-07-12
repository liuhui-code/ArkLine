use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::services::workspace_reference_member_index_service::contains_member_access;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshPathPlan {
    pub affected_paths: Vec<String>,
    pub affected_path_set: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshContentPlan {
    pub contents: HashMap<String, String>,
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
    let mut contents = HashMap::new();
    for path in file_paths.iter().map(|path| path.replace('/', "\\")) {
        if !is_source_file(&path) {
            continue;
        }
        let Ok(content) = fs::read_to_string(filesystem_path(&path)) else {
            continue;
        };
        contents.insert(path, content);
    }
    let member_context_required = contents
        .values()
        .any(|content| contains_member_access(content));
    ReferenceRefreshContentPlan {
        contents,
        member_context_required,
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
