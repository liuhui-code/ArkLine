use crate::services::workspace_stub_index_service::normalize_index_path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct WorkspaceStubRefreshPlan {
    pub(crate) affected_paths: Vec<String>,
    pub(crate) indexed_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
}

pub(crate) fn plan_workspace_stub_refresh(
    indexed_paths: &[String],
    removed_paths: &[String],
) -> WorkspaceStubRefreshPlan {
    let indexed_paths = normalized_unique_paths(indexed_paths);
    let removed_paths = normalized_unique_paths(removed_paths);
    let mut affected_paths = indexed_paths
        .iter()
        .chain(removed_paths.iter())
        .cloned()
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();

    WorkspaceStubRefreshPlan {
        affected_paths,
        indexed_paths,
        removed_paths,
    }
}

fn normalized_unique_paths(paths: &[String]) -> Vec<String> {
    let mut normalized = paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}
