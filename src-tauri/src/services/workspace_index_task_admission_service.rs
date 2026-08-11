use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexTaskCapability {
    WorkspaceBootstrap,
    WorkspaceRefresh,
    FileDelta,
    FileReadiness,
    Completion,
    Navigation,
    DeepContent,
    Sdk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexAffectedScope {
    Workspace,
    CurrentFile,
    ChangedPaths,
    Sdk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexTaskAdmission {
    pub capability: WorkspaceIndexTaskCapability,
    pub scope: WorkspaceIndexAffectedScope,
}

pub(crate) fn task_admission(task: &WorkspaceIndexTask) -> WorkspaceIndexTaskAdmission {
    match &task.kind {
        WorkspaceIndexTaskKind::OpenWorkspace => admission(
            WorkspaceIndexTaskCapability::WorkspaceBootstrap,
            WorkspaceIndexAffectedScope::Workspace,
        ),
        WorkspaceIndexTaskKind::RefreshWorkspace => admission(
            WorkspaceIndexTaskCapability::WorkspaceRefresh,
            WorkspaceIndexAffectedScope::Workspace,
        ),
        WorkspaceIndexTaskKind::IndexSdk => admission(
            WorkspaceIndexTaskCapability::Sdk,
            WorkspaceIndexAffectedScope::Sdk,
        ),
        WorkspaceIndexTaskKind::ChangedPaths => changed_paths_admission(task),
    }
}

pub(crate) fn tasks_can_coalesce(
    existing: &WorkspaceIndexTask,
    incoming: &WorkspaceIndexTask,
) -> bool {
    existing.root_path == incoming.root_path
        && existing.kind == incoming.kind
        && existing.reason == incoming.reason
        && task_admission(existing) == task_admission(incoming)
}

pub(crate) fn latest_wins(task: &WorkspaceIndexTask) -> bool {
    matches!(
        task_admission(task),
        WorkspaceIndexTaskAdmission {
            scope: WorkspaceIndexAffectedScope::CurrentFile,
            ..
        }
    )
}

fn changed_paths_admission(task: &WorkspaceIndexTask) -> WorkspaceIndexTaskAdmission {
    match task.priority {
        WorkspaceIndexTaskPriority::ForegroundCompletion => admission(
            WorkspaceIndexTaskCapability::Completion,
            WorkspaceIndexAffectedScope::CurrentFile,
        ),
        WorkspaceIndexTaskPriority::ForegroundNavigation => admission(
            WorkspaceIndexTaskCapability::Navigation,
            WorkspaceIndexAffectedScope::CurrentFile,
        ),
        WorkspaceIndexTaskPriority::VisibleFiles => admission(
            WorkspaceIndexTaskCapability::FileReadiness,
            WorkspaceIndexAffectedScope::CurrentFile,
        ),
        _ if task.reason.starts_with("full-refresh-deep:") => admission(
            WorkspaceIndexTaskCapability::DeepContent,
            WorkspaceIndexAffectedScope::Workspace,
        ),
        _ => admission(
            WorkspaceIndexTaskCapability::FileDelta,
            WorkspaceIndexAffectedScope::ChangedPaths,
        ),
    }
}

fn admission(
    capability: WorkspaceIndexTaskCapability,
    scope: WorkspaceIndexAffectedScope,
) -> WorkspaceIndexTaskAdmission {
    WorkspaceIndexTaskAdmission { capability, scope }
}

#[cfg(test)]
mod tests {
    use super::{
        latest_wins, task_admission, WorkspaceIndexAffectedScope, WorkspaceIndexTaskCapability,
    };
    use crate::services::workspace_index_scheduler_service::{
        WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
    };

    #[test]
    fn foreground_navigation_is_current_file_latest_wins_work() {
        let task = WorkspaceIndexTask {
            root_path: "/workspace".to_string(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::ForegroundNavigation,
            changed_paths: vec!["Entry.ets".to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 0,
            reason: "foreground-navigation".to_string(),
        };

        assert_eq!(
            task_admission(&task).capability,
            WorkspaceIndexTaskCapability::Navigation
        );
        assert_eq!(
            task_admission(&task).scope,
            WorkspaceIndexAffectedScope::CurrentFile
        );
        assert!(latest_wins(&task));
    }
}
