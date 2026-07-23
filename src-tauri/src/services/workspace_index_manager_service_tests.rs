use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_discovery_store_service::load_discovered_files;
use crate::services::workspace_file_fingerprint_service::classify_file_fingerprints;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
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
    let open_results = manager.drain_index_tasks(&index_runtime).unwrap();
    let open_state = index_runtime.get_index_state(&root_path).unwrap();
    let discovery_results = manager.drain_index_task_results(&index_runtime).unwrap();
    let refresh_results = manager.drain_index_tasks(&index_runtime).unwrap();
    let refreshed_state = index_runtime.get_index_state(&root_path).unwrap();

    assert_eq!(open_results.len(), 1);
    assert!(open_results[0].changed);
    assert!(discovery_results
        .iter()
        .any(|result| result.reason == "workspace-discovery"));
    assert!(refresh_results.iter().any(|result| result.changed));
    assert_eq!(open_state.file_paths.len(), 1);
    assert_eq!(refreshed_state.file_paths.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn open_workspace_schedules_discovery_follow_up_task() {
    let root = unique_temp_dir("workspace-index-manager-discovery-follow-up");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Home.ets"), "struct Home {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let open_results = manager.drain_index_task_results(&index_runtime).unwrap();
    let discovery_results = manager.drain_index_task_results(&index_runtime).unwrap();
    let refresh_results = manager.drain_index_task_results(&index_runtime).unwrap();

    assert_eq!(open_results.len(), 1);
    assert!(discovery_results
        .iter()
        .any(|result| result.reason == "workspace-discovery"));
    assert!(!discovery_results
        .iter()
        .any(|result| result.reason == "background-refresh-after-open"));
    assert!(refresh_results
        .iter()
        .any(|result| result.reason == "background-refresh-after-open"));
    let discovered_files = load_discovered_files(&root_path, 10).unwrap();
    assert_eq!(discovered_files.len(), 1);

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
        generation: None,
        cursor: None,
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
fn ignores_duplicate_watcher_paths_without_status_churn() {
    let root = unique_temp_dir("workspace-index-manager-duplicate-watcher");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = root.join("Index.ets").to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_changed_paths(&root_path, &[changed_path.clone()])
        .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].kind, "changed-paths");
    assert_eq!(statuses[0].status, "queued");
    assert_eq!(statuses[0].generation, 1);
    assert_eq!(statuses[0].target_path_count, Some(1));

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
    assert!(queued[0].last_heartbeat_at.is_none());
    assert!(!queued[0].stalled);
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
    assert!(completed[0].last_heartbeat_at.is_some());
    assert!(!completed[0].stalled);
    assert!(completed[0].finished_at.is_some());
    assert!(completed[0].error.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queued_foreground_status_exposes_bounded_target_paths() {
    let root = unique_temp_dir("workspace-index-manager-target-paths");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let paths = vec![
        root.join("A.ets").to_string_lossy().to_string(),
        root.join("B.ets").to_string_lossy().to_string(),
        root.join("C.ets").to_string_lossy().to_string(),
        root.join("D.ets").to_string_lossy().to_string(),
    ];
    let manager = WorkspaceIndexManagerRuntime::default();

    manager
        .schedule_changed_path_task(
            &root_path,
            &paths,
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            "foreground-navigation",
        )
        .unwrap();
    let queued = manager.get_index_task_statuses(&root_path).unwrap();

    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].kind, "changed-paths");
    assert_eq!(queued[0].reason, "foreground-navigation");
    assert_eq!(queued[0].target_paths, paths[..3].to_vec());
    assert_eq!(queued[0].target_path_count, Some(4));

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
fn maintenance_fence_cancels_pending_tasks_before_mutating_the_store() {
    let root = unique_temp_dir("workspace-index-manager-maintenance");
    let root_path = root.to_string_lossy().to_string();
    let source = root.join("Entry.ets").to_string_lossy().to_string();
    let manager = WorkspaceIndexManagerRuntime::default();
    manager
        .schedule_changed_paths(&root_path, &[source])
        .unwrap();

    manager
        .with_workspace_maintenance(&root_path, || {
            assert!(
                manager
                    .get_queue_pressure(&root_path)?
                    .workspace_pending_task_count
                    == 0
            );
            Ok(())
        })
        .unwrap();

    let statuses = manager.get_index_task_statuses(&root_path).unwrap();
    assert!(statuses
        .iter()
        .any(|status| status.kind == "changed-paths" && status.status == "cancelled"));
    fs::remove_dir_all(root).unwrap_or(());
}
