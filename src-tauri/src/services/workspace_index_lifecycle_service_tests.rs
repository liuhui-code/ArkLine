use std::fs;

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;

#[test]
fn supersedes_pending_refresh_tasks_for_the_same_workspace() {
    let root = create_empty_workspace("refresh-superseded");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager.refresh_workspace_index(&root_path).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    let superseded = statuses
        .iter()
        .find(|status| {
            status.kind == "refresh-workspace"
                && status.status == "superseded"
                && status.generation == 1
        })
        .expect("old refresh should be marked superseded");
    assert_eq!(
        superseded.message.as_deref(),
        Some("Replaced by a newer index task")
    );
    assert_eq!(superseded.progress_current, 1);
    assert_eq!(superseded.progress_total, 1);
    assert!(superseded.started_at.is_none());
    assert!(superseded.finished_at.is_some());
    assert!(superseded.error.is_none());
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supersedes_previous_changed_path_generation_when_coalescing() {
    let root = create_empty_workspace("changed-paths-superseded");
    let root_path = root.to_string_lossy().to_string();
    let first_path = root
        .join("entry/src/main/ets/First.ets")
        .to_string_lossy()
        .to_string();
    let second_path = root
        .join("entry/src/main/ets/Second.ets")
        .to_string_lossy()
        .to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_changed_paths(&root_path, &[first_path])
        .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[second_path])
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "superseded"
            && status.generation == 1
            && status.message.as_deref() == Some("Replaced by a newer index task")
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancelled_pending_sdk_task_is_reported_as_terminal() {
    let root = create_empty_workspace("sdk-cancelled-terminal");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&root_path, "/sdk/old", "old-sdk")
        .unwrap();
    manager
        .schedule_sdk_index(&root_path, "/sdk/new", "new-sdk")
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    let cancelled = statuses
        .iter()
        .find(|status| status.kind == "sdk" && status.status == "cancelled")
        .expect("old SDK task should be cancelled");
    assert_eq!(cancelled.progress_current, 1);
    assert_eq!(cancelled.progress_total, 1);
    assert!(cancelled.started_at.is_none());
    assert!(cancelled.finished_at.is_some());
    assert!(cancelled.error.is_none());
    assert_eq!(
        cancelled.message.as_deref(),
        Some("Replaced by a newer index task")
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refresh_supersedes_pending_changed_paths_for_the_same_workspace() {
    let root = create_empty_workspace("refresh-supersedes-changed-paths");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = root
        .join("entry/src/main/ets/Index.ets")
        .to_string_lossy()
        .to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    manager.refresh_workspace_index(&root_path).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths" && status.status == "superseded" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn open_workspace_supersedes_pending_refresh_for_the_same_workspace() {
    let root = create_empty_workspace("open-supersedes-refresh");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager.open_workspace_index(&root_path).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace"
            && status.status == "superseded"
            && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "open-workspace" && status.status == "queued" && status.generation == 2
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 3
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn open_workspace_queues_light_open_before_background_refresh() {
    let root = create_empty_workspace("open-queues-refresh");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "open-workspace" && status.status == "queued" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}
