#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIncrementalPathPlan {
    pub(crate) changed_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
    pub(crate) affected_paths: Vec<String>,
}

pub(crate) fn plan_incremental_index_paths(
    changed_paths: &[String],
    removed_paths: &[String],
) -> WorkspaceIncrementalPathPlan {
    let changed_paths = normalized_unique_paths(changed_paths);
    let removed_paths = normalized_unique_paths(removed_paths);
    let mut affected_paths = changed_paths
        .iter()
        .chain(removed_paths.iter())
        .cloned()
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();

    WorkspaceIncrementalPathPlan {
        changed_paths,
        removed_paths,
        affected_paths,
    }
}

fn normalized_unique_paths(paths: &[String]) -> Vec<String> {
    let mut normalized = paths
        .iter()
        .map(|path| path.replace('/', "\\"))
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}
