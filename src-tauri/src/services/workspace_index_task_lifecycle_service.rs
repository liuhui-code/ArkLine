use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskKind;

pub fn task_kind_replaces_pending(
    new_kind: &WorkspaceIndexTaskKind,
    existing_kind: &WorkspaceIndexTaskKind,
) -> bool {
    match new_kind {
        WorkspaceIndexTaskKind::OpenWorkspace => matches!(
            existing_kind,
            WorkspaceIndexTaskKind::OpenWorkspace
                | WorkspaceIndexTaskKind::RefreshWorkspace
                | WorkspaceIndexTaskKind::ChangedPaths
        ),
        WorkspaceIndexTaskKind::RefreshWorkspace => matches!(
            existing_kind,
            WorkspaceIndexTaskKind::RefreshWorkspace | WorkspaceIndexTaskKind::ChangedPaths
        ),
        WorkspaceIndexTaskKind::ChangedPaths => {
            *existing_kind == WorkspaceIndexTaskKind::ChangedPaths
        }
        WorkspaceIndexTaskKind::IndexSdk => *existing_kind == WorkspaceIndexTaskKind::IndexSdk,
    }
}

pub fn task_kind_supersedes_result(new_kind: &WorkspaceIndexTaskKind, result_kind: &str) -> bool {
    match new_kind {
        WorkspaceIndexTaskKind::OpenWorkspace => matches!(
            result_kind,
            "open-workspace" | "refresh-workspace" | "changed-paths"
        ),
        WorkspaceIndexTaskKind::RefreshWorkspace => {
            matches!(result_kind, "refresh-workspace" | "changed-paths")
        }
        WorkspaceIndexTaskKind::ChangedPaths => result_kind == "changed-paths",
        WorkspaceIndexTaskKind::IndexSdk => result_kind == "sdk",
    }
}

#[cfg(test)]
mod tests {
    use super::{task_kind_replaces_pending, task_kind_supersedes_result};
    use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskKind;

    #[test]
    fn defines_pending_task_replacement_matrix() {
        let cases = [
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                WorkspaceIndexTaskKind::OpenWorkspace,
                true,
            ),
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                WorkspaceIndexTaskKind::RefreshWorkspace,
                true,
            ),
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                WorkspaceIndexTaskKind::ChangedPaths,
                true,
            ),
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                WorkspaceIndexTaskKind::IndexSdk,
                false,
            ),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                WorkspaceIndexTaskKind::RefreshWorkspace,
                true,
            ),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                WorkspaceIndexTaskKind::ChangedPaths,
                true,
            ),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                WorkspaceIndexTaskKind::OpenWorkspace,
                false,
            ),
            (
                WorkspaceIndexTaskKind::ChangedPaths,
                WorkspaceIndexTaskKind::ChangedPaths,
                true,
            ),
            (
                WorkspaceIndexTaskKind::ChangedPaths,
                WorkspaceIndexTaskKind::RefreshWorkspace,
                false,
            ),
            (
                WorkspaceIndexTaskKind::IndexSdk,
                WorkspaceIndexTaskKind::IndexSdk,
                true,
            ),
            (
                WorkspaceIndexTaskKind::IndexSdk,
                WorkspaceIndexTaskKind::RefreshWorkspace,
                false,
            ),
        ];

        for (new_kind, existing_kind, expected) in cases {
            assert_eq!(
                task_kind_replaces_pending(&new_kind, &existing_kind),
                expected,
                "{new_kind:?} replacing {existing_kind:?}"
            );
        }
    }

    #[test]
    fn defines_running_result_supersession_matrix() {
        let cases = [
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                "open-workspace",
                true,
            ),
            (
                WorkspaceIndexTaskKind::OpenWorkspace,
                "refresh-workspace",
                true,
            ),
            (WorkspaceIndexTaskKind::OpenWorkspace, "changed-paths", true),
            (WorkspaceIndexTaskKind::OpenWorkspace, "sdk", false),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                "refresh-workspace",
                true,
            ),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                "changed-paths",
                true,
            ),
            (
                WorkspaceIndexTaskKind::RefreshWorkspace,
                "open-workspace",
                false,
            ),
            (WorkspaceIndexTaskKind::ChangedPaths, "changed-paths", true),
            (
                WorkspaceIndexTaskKind::ChangedPaths,
                "refresh-workspace",
                false,
            ),
            (WorkspaceIndexTaskKind::IndexSdk, "sdk", true),
            (WorkspaceIndexTaskKind::IndexSdk, "changed-paths", false),
        ];

        for (new_kind, result_kind, expected) in cases {
            assert_eq!(
                task_kind_supersedes_result(&new_kind, result_kind),
                expected,
                "{new_kind:?} superseding {result_kind}"
            );
        }
    }
}
