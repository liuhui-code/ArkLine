use std::fs;

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir, unique_temp_dir,
};

#[test]
fn supersedes_running_sdk_result_when_newer_sdk_is_queued() {
    let root = create_empty_workspace("running-sdk-superseded");
    let old_sdk = root.join("old-sdk");
    let new_sdk = root.join("new-sdk");
    fs::create_dir_all(old_sdk.join("ets")).unwrap();
    fs::create_dir_all(new_sdk.join("ets")).unwrap();
    fs::write(
        old_sdk.join("ets").join("old.d.ts"),
        "declare class OldText {\n  width(value: Length): OldText;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk.join("ets").join("new.d.ts"),
        "declare class NewText {\n  height(value: Length): NewText;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let old_sdk_path = old_sdk.to_string_lossy().to_string();
    let new_sdk_path = new_sdk.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let manager_for_callback = manager.clone();
    let root_for_callback = root_path.clone();

    manager
        .schedule_sdk_index(&root_path, &old_sdk_path, "old-sdk")
        .unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, move |status| {
            if status.kind == "sdk" && status.status == "running" {
                manager_for_callback
                    .schedule_sdk_index(&root_for_callback, &new_sdk_path, "new-sdk")
                    .unwrap();
            }
        })
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "sdk");
    assert_eq!(results[0].status, "superseded");
    assert_eq!(results[0].sdk_symbol_count, None);
    assert!(statuses.iter().any(|status| {
        status.kind == "sdk" && status.status == "superseded" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "sdk" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supersedes_running_refresh_result_when_newer_refresh_is_queued() {
    let root = unique_temp_dir("running-refresh-superseded");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"RunningRefresh\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let manager_for_callback = manager.clone();
    let root_for_callback = root_path.clone();

    manager.refresh_workspace_index(&root_path).unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, move |status| {
            if status.kind == "refresh-workspace" && status.status == "running" {
                manager_for_callback
                    .refresh_workspace_index(&root_for_callback)
                    .unwrap();
            }
        })
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "refresh-workspace");
    assert_eq!(results[0].status, "superseded");
    assert!(results[0].refresh_result.is_none());
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace"
            && status.status == "superseded"
            && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supersedes_running_refresh_result_when_newer_open_is_queued() {
    let root = unique_temp_dir("running-refresh-open-superseded");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"RunningOpen\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let manager_for_callback = manager.clone();
    let root_for_callback = root_path.clone();

    manager.refresh_workspace_index(&root_path).unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, move |status| {
            if status.kind == "refresh-workspace" && status.status == "running" {
                manager_for_callback
                    .open_workspace_index(&root_for_callback)
                    .unwrap();
            }
        })
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "refresh-workspace");
    assert_eq!(results[0].status, "superseded");
    assert!(results[0].refresh_result.is_none());
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace"
            && status.status == "superseded"
            && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "open-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supersedes_running_changed_paths_result_when_newer_change_is_queued() {
    let root = unique_temp_dir("running-changed-paths-superseded");
    let source_dir = create_workspace_source_dir(&root);
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"BeforeChangedPaths\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"AfterChangedPaths\") }\n}\n",
    )
    .unwrap();
    let manager_for_callback = manager.clone();
    let root_for_callback = root_path.clone();
    let path_for_callback = changed_path.clone();

    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, move |status| {
            if status.kind == "changed-paths" && status.status == "running" {
                manager_for_callback
                    .schedule_changed_paths(&root_for_callback, &[path_for_callback.clone()])
                    .unwrap();
            }
        })
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "changed-paths");
    assert_eq!(results[0].status, "superseded");
    assert!(results[0].refresh_result.is_none());
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths" && status.status == "superseded" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supersedes_running_changed_paths_result_when_newer_refresh_is_queued() {
    let root = unique_temp_dir("running-changed-paths-refresh-superseded");
    let source_dir = create_workspace_source_dir(&root);
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"BeforeRefreshOverride\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"AfterRefreshOverride\") }\n}\n",
    )
    .unwrap();
    let manager_for_callback = manager.clone();
    let root_for_callback = root_path.clone();

    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, move |status| {
            if status.kind == "changed-paths" && status.status == "running" {
                manager_for_callback
                    .refresh_workspace_index(&root_for_callback)
                    .unwrap();
            }
        })
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "changed-paths");
    assert_eq!(results[0].status, "superseded");
    assert!(results[0].refresh_result.is_none());
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths" && status.status == "superseded" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "refresh-workspace" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap();
}
