use std::fs;

use crate::services::workspace_index_health_service::get_workspace_index_health;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_resume_service::save_resume_task;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn reports_healthy_workspace_with_queue_pressure() {
    let root = unique_temp_dir("workspace-index-health-ready");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let sdk_dir = root.join("openharmony/ets");
    fs::create_dir_all(&sdk_dir).unwrap();
    fs::write(
        sdk_dir.join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = root.join("openharmony").to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_path, "test-sdk").unwrap();
    manager.refresh_workspace_index(&root_path).unwrap();

    let health = get_workspace_index_health(&root_path, &manager).unwrap();

    assert_eq!(health.root_path, root_path.replace('/', "\\"));
    assert_eq!(health.status, "healthy");
    assert!(health.file_count >= 1);
    assert!(health.symbol_count >= 1);
    assert_eq!(health.queue_pressure.pending_task_count, 1);
    assert_eq!(health.queue_pressure.workspace_pending_task_count, 1);
    assert!(health.repair_actions.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_missing_sdk_when_api_features_need_sdk_symbols() {
    let root = unique_temp_dir("workspace-index-health-missing-sdk");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    let health = get_workspace_index_health(&root_path, &manager).unwrap();

    assert_eq!(health.status, "missingSdk");
    assert_eq!(health.sdk_api_count, 0);
    assert!(health
        .repair_actions
        .iter()
        .any(|action| action == "configureSdk"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_rebuild_sdk_action_when_active_sdk_has_no_symbols() {
    let root = unique_temp_dir("workspace-index-health-rebuild-sdk");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let sdk_dir = root.join("openharmony");
    fs::create_dir_all(&sdk_dir).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_dir.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_path, "empty-sdk").unwrap();

    let health = get_workspace_index_health(&root_path, &manager).unwrap();

    assert_eq!(health.status, "missingSdk");
    assert!(health
        .repair_actions
        .iter()
        .any(|action| action == "rebuildSdkIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_resume_action_when_resume_tasks_are_persisted() {
    let root = unique_temp_dir("workspace-index-health-resume");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Resume.ets");
    fs::write(&source_file, "struct Resume {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    save_resume_task(
        &root_path,
        &WorkspaceIndexTask {
            root_path: root_path.clone(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: vec![source_file.to_string_lossy().to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 7,
            reason: "full-refresh-continuation:refresh-workspace".to_string(),
        },
    )
    .unwrap();

    let health = get_workspace_index_health(&root_path, &manager).unwrap();

    assert!(health
        .repair_actions
        .iter()
        .any(|action| action == "resumeIndexing"));

    fs::remove_dir_all(root).unwrap();
}
