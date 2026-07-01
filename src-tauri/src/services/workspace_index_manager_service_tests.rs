use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_file_fingerprint_service::classify_file_fingerprints;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn opens_workspace_index_through_the_manager_entry_point() {
    let root = unique_temp_dir("workspace-index-manager-open");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Home.ets"),
        "struct Home {\n  build() { Text(\"OpenThroughManager\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let results = manager.drain_index_tasks(&index_runtime).unwrap();
    let state = index_runtime.get_index_state(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].changed);
    assert_eq!(state.file_paths.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn coalesces_watcher_changes_before_refreshing_the_index() {
    let root = unique_temp_dir("workspace-index-manager-coalesce");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"BeforeManagerRefresh\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"AfterManagerRefresh\") }\n}\n",
    )
    .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path.clone()])
        .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();

    let results = manager.drain_index_tasks(&index_runtime).unwrap();
    let matches = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "AfterManagerRefresh".to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 0,
    })
    .unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].changed);
    assert_eq!(matches.matches.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn skips_watcher_refresh_when_fingerprints_are_unchanged() {
    let root = unique_temp_dir("workspace-index-manager-unchanged");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"UnchangedFingerprint\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    let fingerprint_changes =
        classify_file_fingerprints(&root_path, &[changed_path.clone()]).unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let results = manager.drain_index_tasks(&index_runtime).unwrap();

    assert!(fingerprint_changes
        .iter()
        .all(|change| change.status
            == crate::services::workspace_file_fingerprint_service::WorkspaceFileFingerprintStatus::Unchanged));
    assert!(results.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_skipped_status_when_changed_paths_are_unchanged() {
    let root = unique_temp_dir("workspace-index-manager-skipped");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"SkippedFingerprint\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let results = manager.drain_index_task_results(&index_runtime).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "changed-paths");
    assert_eq!(results[0].status, "skipped");
    assert_eq!(results[0].reason, "watcher");
    assert!(results[0].error.is_none());
    assert!(results[0].started_at.is_some());
    assert!(results[0].finished_at.is_some());
    assert!(results[0].refresh_result.is_none());
    let skipped = statuses
        .iter()
        .find(|status| status.kind == "changed-paths" && status.status == "skipped")
        .expect("skipped status should be visible");
    assert_eq!(skipped.progress_current, 1);
    assert_eq!(skipped.progress_total, 1);
    assert_eq!(
        skipped.message.as_deref(),
        Some("No changed paths require reindexing")
    );
    assert!(skipped.error.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn schedules_sdk_index_through_the_manager_entry_point() {
    let root = unique_temp_dir("workspace-index-manager-sdk");
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
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let results = manager.drain_index_task_results(&index_runtime).unwrap();
    let matches = query_workspace_sdk_symbols(&root_path, "Text width", 8).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].root_path, root_path);
    assert_eq!(results[0].kind, "sdk");
    assert_eq!(results[0].status, "ready");
    assert_eq!(results[0].sdk_symbol_count, Some(2));
    assert!(results[0].refresh_result.is_none());
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].source, "api");
    assert_eq!(matches[0].title, "width");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn exposes_latest_index_task_status_for_a_workspace() {
    let root = unique_temp_dir("workspace-index-manager-status");
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
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let queued = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].kind, "sdk");
    assert_eq!(queued[0].status, "queued");
    assert_eq!(queued[0].task_id, "1:sdk");
    assert_eq!(queued[0].progress_current, 0);
    assert_eq!(queued[0].progress_total, 1);
    assert!(queued[0].started_at.is_none());
    assert!(queued[0].finished_at.is_none());

    manager.drain_index_task_results(&index_runtime).unwrap();
    let completed = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].kind, "sdk");
    assert_eq!(completed[0].status, "ready");
    assert_eq!(completed[0].symbol_count, Some(2));
    assert_eq!(completed[0].progress_current, 1);
    assert_eq!(completed[0].progress_total, 1);
    assert!(completed[0].started_at.is_some());
    assert!(completed[0].finished_at.is_some());
    assert!(completed[0].error.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn replaces_pending_sdk_task_and_marks_old_generation_cancelled() {
    let root = unique_temp_dir("workspace-index-manager-cancel-sdk");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_sdk_index(&root_path, "/sdk/old", "old-sdk")
        .unwrap();
    manager
        .schedule_sdk_index(&root_path, "/sdk/new", "new-sdk")
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses.iter().any(|status| {
        status.kind == "sdk" && status.status == "cancelled" && status.generation == 1
    }));
    assert!(statuses.iter().any(|status| {
        status.kind == "sdk" && status.status == "queued" && status.generation == 2
    }));

    fs::remove_dir_all(root).unwrap_or(());
}

#[test]
fn worker_runner_reports_running_and_ready_statuses() {
    let root = unique_temp_dir("workspace-index-manager-worker");
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
    let root = unique_temp_dir("workspace-index-manager-background");
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
    let manager = WorkspaceIndexManagerRuntime::default();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_for_worker = observed.clone();

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();
    let started = manager
        .start_background_worker(index_runtime.clone(), move |status| {
            observed_for_worker
                .lock()
                .unwrap()
                .push((status.kind, status.status));
        })
        .unwrap();

    assert!(started);
    for _ in 0..20 {
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
        .any(|status| status == &("sdk".to_string(), "running".to_string())));
    assert!(observed
        .iter()
        .any(|status| status == &("sdk".to_string(), "ready".to_string())));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn background_worker_waits_and_wakes_when_a_task_is_scheduled() {
    let root = unique_temp_dir("workspace-index-manager-wake");
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
    let manager = WorkspaceIndexManagerRuntime::default();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_for_worker = observed.clone();

    let started = manager
        .start_background_worker(index_runtime.clone(), move |status| {
            observed_for_worker
                .lock()
                .unwrap()
                .push((status.kind, status.status));
        })
        .unwrap();
    assert!(started);
    thread::sleep(Duration::from_millis(50));
    assert!(observed.lock().unwrap().is_empty());

    manager
        .schedule_sdk_index(&root_path, &sdk_path, "test-sdk")
        .unwrap();

    for _ in 0..20 {
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
        .any(|status| status == &("sdk".to_string(), "running".to_string())));
    assert!(observed
        .iter()
        .any(|status| status == &("sdk".to_string(), "ready".to_string())));

    fs::remove_dir_all(root).unwrap();
}
