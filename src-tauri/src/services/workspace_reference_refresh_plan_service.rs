use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReferenceRefreshPathPlan {
    pub affected_paths: Vec<String>,
    pub affected_path_set: HashSet<String>,
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
