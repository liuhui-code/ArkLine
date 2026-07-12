use std::collections::HashSet;

pub(crate) struct DependencyGraphPathPlan {
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_path_set: HashSet<String>,
    pub(crate) removed_path_set: HashSet<String>,
}

pub(crate) fn plan_dependency_graph_paths(
    indexed_paths: &[String],
    removed_paths: &[String],
) -> DependencyGraphPathPlan {
    let mut affected_paths = indexed_paths
        .iter()
        .chain(removed_paths.iter())
        .map(|path| normalize_index_path(path))
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();
    let affected_path_set = affected_paths.iter().cloned().collect::<HashSet<_>>();
    let removed_path_set = removed_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    DependencyGraphPathPlan {
        affected_paths,
        affected_path_set,
        removed_path_set,
    }
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
