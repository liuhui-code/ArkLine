use std::fs;

use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::run_index_tasks;
use crate::services::workspace_sdk_index_task_service::WORKSPACE_SDK_API_INDEX_CHUNK_SIZE;

#[test]
fn worker_sdk_index_yields_after_first_api_chunk() {
    let root = create_empty_workspace("worker-sdk-api-chunks");
    let sdk_dir = root.join("sdk").join("api");
    fs::create_dir_all(&sdk_dir).unwrap();
    for index in 0..(WORKSPACE_SDK_API_INDEX_CHUNK_SIZE + 1) {
        fs::write(
            sdk_dir.join(format!("api{index}.d.ts")),
            format!("export interface Api{index} {{\n  method{index}(): void;\n}}\n"),
        )
        .unwrap();
    }
    let task = WorkspaceIndexTask {
        root_path: root.to_string_lossy().to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::SdkIndexing,
        changed_paths: Vec::new(),
        sdk_path: Some(root.join("sdk").to_string_lossy().to_string()),
        sdk_version: Some("api-test".to_string()),
        generation: 3,
        reason: "sdk-apply".to_string(),
    };

    let results =
        run_index_tasks(&WorkspaceIndexRuntime::default(), vec![task], |_| Ok(())).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "sdk");
    assert_eq!(results[0].status, "partial");
    assert_eq!(results[0].progress_current, 1);
    assert_eq!(results[0].progress_total, 2);
    assert_eq!(results[0].sdk_remaining_files.len(), 1);
    assert_eq!(
        results[0].message.as_deref(),
        Some("SDK API index yielded with remaining chunks")
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_reuses_ready_sdk_artifact_without_reparsing() {
    let root = create_empty_workspace("worker-sdk-artifact-reuse");
    let sdk_dir = root.join("sdk").join("api");
    fs::create_dir_all(&sdk_dir).unwrap();
    for index in 0..(WORKSPACE_SDK_API_INDEX_CHUNK_SIZE + 1) {
        fs::write(
            sdk_dir.join(format!("api{index}.d.ts")),
            format!("export interface Api{index} {{ method{index}(): void; }}\n"),
        )
        .unwrap();
    }
    let full_task = WorkspaceIndexTask {
        root_path: root.to_string_lossy().to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::SdkIndexing,
        changed_paths: Vec::new(),
        sdk_path: Some(root.join("sdk").to_string_lossy().to_string()),
        sdk_version: Some("api-test".to_string()),
        generation: 10,
        reason: "sdk-apply".to_string(),
    };
    let runtime = WorkspaceIndexRuntime::default();
    let first = run_index_tasks(&runtime, vec![full_task.clone()], |_| Ok(())).unwrap();
    let continuation = WorkspaceIndexTask {
        changed_paths: first[0].sdk_remaining_files.clone(),
        generation: 11,
        ..full_task.clone()
    };
    let completed = run_index_tasks(&runtime, vec![continuation], |_| Ok(())).unwrap();
    let reused = run_index_tasks(
        &runtime,
        vec![WorkspaceIndexTask {
            generation: 12,
            ..full_task
        }],
        |_| Ok(()),
    )
    .unwrap();

    assert_eq!(completed[0].status, "ready");
    assert_eq!(
        reused[0].message.as_deref(),
        Some("Reused shared SDK artifact")
    );
    assert_eq!(reused[0].status, "ready");
    assert!(reused[0].sdk_symbol_count.unwrap_or_default() > 0);
    fs::remove_dir_all(root).unwrap();
}
