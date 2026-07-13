use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn create_sdk_fixture(name: &str) -> (PathBuf, String, String) {
    let root = unique_temp_dir(name);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    (
        root.clone(),
        root.to_string_lossy().to_string(),
        sdk_root.to_string_lossy().to_string(),
    )
}

#[test]
fn worker_runner_reports_running_and_ready_statuses() {
    let (root, root_path, sdk_path) = create_sdk_fixture("workspace-index-manager-worker");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let mut observed = Vec::new();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, |status| observed.push(status))
        .unwrap();

    assert_eq!(results.len(), 1);
    assert!(observed
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "running"));
    assert!(observed
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "ready"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn background_worker_drains_tasks_and_reports_statuses() {
    let (root, root_path, sdk_path) = create_sdk_fixture("workspace-index-manager-background");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_for_worker = observed.clone();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let started = manager
        .start_background_worker_with_events(index_runtime.clone(), move |status, _events| {
            observed_for_worker
                .lock()
                .unwrap()
                .push((status.kind, status.status));
        })
        .unwrap();

    assert!(started);
    for _ in 0..80 {
        if observed
            .lock()
            .unwrap()
            .iter()
            .any(|status| status == &("sdk".to_string(), "ready".to_string()))
        {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    let observed = observed.lock().unwrap().clone();

    assert!(observed
        .iter()
        .any(|status| status == &("sdk".to_string(), "ready".to_string())));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn background_worker_processes_task_scheduled_before_start() {
    let (root, root_path, sdk_path) = create_sdk_fixture("workspace-index-manager-wake");
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let queued = manager.get_index_task_statuses(&root_path).unwrap();
    assert!(queued
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "queued"));

    let started = manager
        .start_background_worker_with_events(index_runtime.clone(), |_, _| {})
        .unwrap();
    assert!(started);

    for _ in 0..80 {
        if manager
            .get_index_task_statuses(&root_path)
            .unwrap()
            .iter()
            .any(|status| status.kind == "sdk" && status.status == "ready")
        {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "ready"));

    fs::remove_dir_all(root).unwrap();
}
