use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::workspace::{
    index_workspace_sdk_symbols_through_manager_with_status,
    submit_workspace_sdk_index_through_manager,
};
use crate::commands::workspace_index_schedule::{
    schedule_foreground_completion_index_through_manager,
    schedule_foreground_navigation_index_through_manager,
    schedule_visible_files_index_through_manager,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_open_command_service::open_workspace_through_manager;
use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;

#[test]
fn open_workspace_command_returns_snapshot_and_queues_background_index() {
    let root = unique_temp_dir("open-workspace-background-index");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    let snapshot =
        open_workspace_through_manager(
            index_runtime,
            index_manager.clone(),
            crate::services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime::default(),
            &root_path,
            |_, _| {},
        )
            .unwrap();
    let statuses = index_manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(snapshot.root_path, root_path);
    assert!(snapshot.files.is_empty());
    assert!(snapshot.scan_summary.truncated);
    assert!(statuses.iter().any(|status| {
        status.kind == "open-workspace"
            && matches!(
                status.status.as_str(),
                "queued" | "running" | "ready" | "partial"
            )
    }));

    fs::remove_dir_all(root).unwrap();
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-command-workspace-{name}-{suffix}"))
}

#[test]
fn sdk_index_command_uses_manager_task_result_summary() {
    let root = unique_temp_dir("sdk-command");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    let (summary, _, events) = index_workspace_sdk_symbols_through_manager_with_status(
        &index_runtime,
        &index_manager,
        &root_path,
        &sdk_path,
        "test-sdk",
    )
    .unwrap();
    let matches = query_workspace_sdk_symbols(&root_path, "Text width", 8).unwrap();

    assert_eq!(summary.symbol_count, 2);
    assert!(events
        .iter()
        .any(|event| event.scope == "task" && event.kind == "sdk"));
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].title, "width");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn sdk_index_command_collects_worker_statuses() {
    let root = unique_temp_dir("sdk-command-status");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    let (_, statuses, _) = index_workspace_sdk_symbols_through_manager_with_status(
        &index_runtime,
        &index_manager,
        &root_path,
        &sdk_path,
        "test-sdk",
    )
    .unwrap();

    assert!(statuses
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "running"));
    assert!(statuses
        .iter()
        .any(|status| status.kind == "sdk" && status.status == "ready"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn submit_sdk_index_command_returns_queued_status_and_finishes_in_background() {
    let root = unique_temp_dir("sdk-command-submit");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let index_manager = WorkspaceIndexManagerRuntime::default();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_for_worker = observed.clone();

    let queued = submit_workspace_sdk_index_through_manager(
        index_runtime,
        index_manager,
        &root_path,
        &sdk_path,
        "test-sdk",
        move |status, _| observed_for_worker.lock().unwrap().push(status.status),
    )
    .unwrap();

    assert_eq!(queued.kind, "sdk");
    assert_eq!(queued.status, "queued");
    for _ in 0..20 {
        if observed
            .lock()
            .unwrap()
            .iter()
            .any(|status| status == "ready")
        {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    assert!(observed
        .lock()
        .unwrap()
        .iter()
        .any(|status| status == "ready"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn foreground_completion_schedule_command_queues_completion_priority_task() {
    let root = unique_temp_dir("completion-schedule-command");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = root.join("entry/src/main/ets/Main.ets");
    fs::create_dir_all(changed_path.parent().unwrap()).unwrap();
    fs::write(&changed_path, "struct Main {}\n").unwrap();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    schedule_foreground_completion_index_through_manager(
        &index_manager,
        &root_path,
        &[changed_path.to_string_lossy().to_string()],
    )
    .unwrap();
    let statuses = index_manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "foreground-completion"
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn foreground_navigation_schedule_command_queues_navigation_priority_task() {
    let root = unique_temp_dir("navigation-schedule-command");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = root.join("entry/src/main/ets/Main.ets");
    fs::create_dir_all(changed_path.parent().unwrap()).unwrap();
    fs::write(&changed_path, "struct Main {}\n").unwrap();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    schedule_foreground_navigation_index_through_manager(
        &index_manager,
        &root_path,
        &[changed_path.to_string_lossy().to_string()],
    )
    .unwrap();
    let statuses = index_manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "foreground-navigation"
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn visible_files_schedule_command_queues_visible_priority_task() {
    let root = unique_temp_dir("visible-schedule-command");
    let root_path = root.to_string_lossy().to_string();
    let changed_path = root.join("entry/src/main/ets/Visible.ets");
    fs::create_dir_all(changed_path.parent().unwrap()).unwrap();
    fs::write(&changed_path, "struct Visible {}\n").unwrap();
    let index_manager = WorkspaceIndexManagerRuntime::default();

    schedule_visible_files_index_through_manager(
        &index_manager,
        &root_path,
        &[changed_path.to_string_lossy().to_string()],
    )
    .unwrap();
    let statuses = index_manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "visible-files"
    }));

    fs::remove_dir_all(root).unwrap();
}
