use std::fs;

use crate::models::workspace::WorkspaceIndexQueuePressure;
use crate::services::workspace_index_diagnostics_service::{
    inspect_workspace_index, inspect_workspace_index_with_queue_pressure,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn reports_active_sdk_index_metadata_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-sdk");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&root_path, &sdk_path, "test-sdk").unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(
        diagnostics.active_sdk_path.as_deref(),
        Some(sdk_path.as_str())
    );
    assert_eq!(diagnostics.active_sdk_version.as_deref(), Some("test-sdk"));
    assert_eq!(diagnostics.sdk_symbol_count, 2);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_queued_diagnostics_when_workspace_work_is_pending() {
    let root = unique_temp_dir("workspace-index-diagnostics-queued");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let queue_pressure = WorkspaceIndexQueuePressure {
        root_path: root_path.clone(),
        pending_task_count: 1,
        workspace_pending_task_count: 1,
        highest_priority: Some("full-refresh".to_string()),
        highest_priority_task_kind: Some("refresh-workspace".to_string()),
    };

    let diagnostics =
        inspect_workspace_index_with_queue_pressure(&root_path, queue_pressure).unwrap();

    assert_eq!(diagnostics.status, "queued");
    assert_eq!(diagnostics.queue_pressure.workspace_pending_task_count, 1);
    assert!(!diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "rebuildProjectIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_queued_diagnostics_when_sdk_index_work_is_pending() {
    let root = unique_temp_dir("workspace-index-diagnostics-sdk-queued");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let queue_pressure = WorkspaceIndexQueuePressure {
        root_path: root_path.clone(),
        pending_task_count: 1,
        workspace_pending_task_count: 1,
        highest_priority: Some("sdk-indexing".to_string()),
        highest_priority_task_kind: Some("sdk".to_string()),
    };

    let diagnostics =
        inspect_workspace_index_with_queue_pressure(&root_path, queue_pressure).unwrap();

    assert_eq!(diagnostics.status, "queued");
    assert_eq!(diagnostics.sdk_symbol_count, 0);
    assert!(!diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "configureSdk" || action == "rebuildSdkIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_sdk_symbol_count_for_the_active_sdk_only() {
    let root = unique_temp_dir("workspace-index-diagnostics-active-sdk-count");
    let old_sdk_root = root.join("old-openharmony");
    let new_sdk_root = root.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class Legacy {\n  oldOnly(value: Length): Legacy;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class Current {\n  currentOnly(value: Length): Current;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&root_path, &old_sdk_path, "old-sdk").unwrap();
    index_workspace_sdk_symbols(&root_path, &new_sdk_path, "new-sdk").unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(
        diagnostics.active_sdk_path.as_deref(),
        Some(new_sdk_path.as_str())
    );
    assert_eq!(diagnostics.active_sdk_version.as_deref(), Some("new-sdk"));
    assert_eq!(diagnostics.sdk_symbol_count, 2);

    fs::remove_dir_all(root).unwrap();
}
