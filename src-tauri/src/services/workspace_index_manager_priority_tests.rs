use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_manager_service::{
    WorkspaceIndexManagerRuntime, WORKSPACE_INDEX_WORKER_TASK_BATCH_SIZE,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn create_source_file(root: &PathBuf, name: &str) -> String {
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join(name);
    fs::write(&source_file, "struct PriorityProbe {}\n").unwrap();
    source_file.to_string_lossy().to_string()
}

#[test]
fn foreground_completion_index_runs_before_sdk_indexing() {
    let root = unique_temp_dir("workspace-index-manager-completion-priority");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = create_source_file(&root, "Completion.ets");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let mut observed = Vec::new();

    manager
        .schedule_sdk_index(&root_path, "/missing-sdk", "missing-sdk")
        .unwrap();
    manager
        .schedule_foreground_completion_index(&root_path, &[changed_path])
        .unwrap();
    manager
        .run_index_worker_once(&index_runtime, |status| {
            observed.push((status.kind, status.status, status.reason));
        })
        .unwrap();

    assert_eq!(
        observed.first(),
        Some(&(
            "changed-paths".to_string(),
            "running".to_string(),
            "foreground-completion".to_string()
        ))
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn visible_file_index_runs_before_full_refresh() {
    let root = unique_temp_dir("workspace-index-manager-visible-priority");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = create_source_file(&root, "Visible.ets");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let mut observed = Vec::new();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager
        .schedule_visible_files_index(&root_path, &[changed_path])
        .unwrap();
    manager
        .run_index_worker_once(&index_runtime, |status| {
            observed.push((status.kind, status.status, status.reason));
        })
        .unwrap();

    assert_eq!(
        observed.first(),
        Some(&(
            "changed-paths".to_string(),
            "running".to_string(),
            "visible-files".to_string()
        ))
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_tick_drains_only_one_bounded_task_batch() {
    let root = unique_temp_dir("workspace-index-manager-bounded-batch");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let mut roots = Vec::new();

    for index in 0..(WORKSPACE_INDEX_WORKER_TASK_BATCH_SIZE + 1) {
        let task_root = root.join(format!("workspace-{index}"));
        fs::create_dir_all(task_root.join("entry/src/main/ets")).unwrap();
        fs::write(
            task_root.join("entry/src/main/ets/Index.ets"),
            format!("struct Index{index} {{}}\n"),
        )
        .unwrap();
        let task_root_path = task_root.to_string_lossy().to_string();
        manager.refresh_workspace_index(&task_root_path).unwrap();
        roots.push(task_root_path);
    }

    let mut observed = Vec::new();
    manager
        .run_index_worker_once(&index_runtime, |status| {
            if status.status == "running" {
                observed.push(status.root_path);
            }
        })
        .unwrap();

    assert_eq!(observed.len(), WORKSPACE_INDEX_WORKER_TASK_BATCH_SIZE);
    let pending = manager
        .get_index_task_statuses(roots.last().unwrap())
        .unwrap();
    assert!(pending.iter().any(|status| status.status == "queued"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_queue_pressure_for_pending_index_tasks() {
    let root = unique_temp_dir("workspace-index-manager-queue-pressure");
    let first_root = root.join("first");
    let second_root = root.join("second");
    fs::create_dir_all(first_root.join("entry/src/main/ets")).unwrap();
    fs::create_dir_all(second_root.join("entry/src/main/ets")).unwrap();
    let first_root_path = first_root.to_string_lossy().to_string();
    let second_root_path = second_root.to_string_lossy().to_string();
    let changed_path = create_source_file(&first_root, "Visible.ets");
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&first_root_path).unwrap();
    manager
        .schedule_visible_files_index(&first_root_path, &[changed_path])
        .unwrap();
    manager.refresh_workspace_index(&second_root_path).unwrap();

    let pressure = manager.get_queue_pressure(&first_root_path).unwrap();

    assert_eq!(pressure.root_path, first_root_path);
    assert_eq!(pressure.pending_task_count, 3);
    assert_eq!(pressure.workspace_pending_task_count, 2);
    assert_eq!(pressure.highest_priority.as_deref(), Some("visibleFiles"));
    assert_eq!(
        pressure.highest_priority_task_kind.as_deref(),
        Some("changed-paths")
    );

    fs::remove_dir_all(root).unwrap();
}
