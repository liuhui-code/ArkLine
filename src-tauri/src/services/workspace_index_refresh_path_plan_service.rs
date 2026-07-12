use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexRefreshPathPlan {
    pub(crate) previous_paths: HashSet<String>,
    pub(crate) current_paths: HashSet<String>,
    pub(crate) added_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
    pub(crate) direct_content_paths: Vec<String>,
    pub(crate) dependency_seed_paths: Vec<String>,
}

pub(crate) fn plan_workspace_index_refresh_paths(
    previous_paths: &[String],
    current_paths: &[String],
    changed_paths: &[String],
) -> WorkspaceIndexRefreshPathPlan {
    let previous_paths = normalized_path_set(previous_paths);
    let current_paths = normalized_path_set(current_paths);
    let mut added_paths = current_paths
        .difference(&previous_paths)
        .cloned()
        .collect::<Vec<_>>();
    let mut removed_paths = previous_paths
        .difference(&current_paths)
        .cloned()
        .collect::<Vec<_>>();

    added_paths.sort();
    removed_paths.sort();

    let direct_content_paths = normalized_unique_paths(changed_paths)
        .into_iter()
        .filter(|path| current_paths.contains(path))
        .collect::<Vec<_>>();
    let mut dependency_seed_paths = normalized_unique_paths(changed_paths);
    dependency_seed_paths.extend(removed_paths.clone());
    dependency_seed_paths.sort();
    dependency_seed_paths.dedup();

    WorkspaceIndexRefreshPathPlan {
        previous_paths,
        current_paths,
        added_paths,
        removed_paths,
        direct_content_paths,
        dependency_seed_paths,
    }
}

fn normalized_path_set(paths: &[String]) -> HashSet<String> {
    paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>()
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

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
