use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::run_index_tasks;
use crate::services::workspace_index_writer_actor_service::WorkspaceIndexWriterActor;
use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;
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

    let actor = WorkspaceIndexWriterActor::shared();
    let publication_samples_before = actor.snapshot().sample_count;
    let sdk_samples_before = actor.snapshot().sdk_publication_count;
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
    assert!(actor.snapshot().sample_count > publication_samples_before);
    assert!(actor.snapshot().sdk_publication_count > sdk_samples_before);

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

#[test]
fn failed_actor_binding_keeps_the_previous_sdk_active() {
    let root = create_empty_workspace("worker-sdk-actor-atomic");
    let old_sdk = root.join("old-sdk");
    let new_sdk = root.join("new-sdk");
    fs::create_dir_all(&old_sdk).unwrap();
    fs::create_dir_all(&new_sdk).unwrap();
    fs::write(old_sdk.join("old.d.ts"), "export class LegacyApi {}\n").unwrap();
    fs::write(new_sdk.join("new.d.ts"), "export class CurrentApi {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let old_task = sdk_task(&root_path, &old_sdk.to_string_lossy(), "old", 20);
    let first = run_index_tasks(&runtime, vec![old_task], |_| Ok(())).unwrap();
    assert_eq!(first[0].status, "ready");
    Connection::open(root.join(".arkline/index/workspace-catalog.sqlite"))
        .unwrap()
        .execute_batch(
            "create trigger reject_current_sdk
             before insert on workspace_sdk_symbols
             when new.name = 'CurrentApi'
             begin select raise(abort, 'sdk actor binding rejected'); end;",
        )
        .unwrap();

    let failed = run_index_tasks(
        &runtime,
        vec![sdk_task(&root_path, &new_sdk.to_string_lossy(), "new", 21)],
        |_| Ok(()),
    )
    .unwrap();

    assert_eq!(failed[0].status, "failed");
    assert!(failed[0]
        .error
        .as_deref()
        .is_some_and(|error| error.contains("sdk actor binding rejected")));
    assert_eq!(
        query_workspace_sdk_symbols(&root_path, "LegacyApi", 8)
            .unwrap()
            .len(),
        1
    );
    assert!(query_workspace_sdk_symbols(&root_path, "CurrentApi", 8)
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read_dir(root.join(".arkline/index/staging"))
            .unwrap()
            .count(),
        0
    );
    fs::remove_dir_all(root).unwrap();
}

fn sdk_task(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    generation: u64,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::SdkIndexing,
        changed_paths: Vec::new(),
        sdk_path: Some(sdk_path.to_string()),
        sdk_version: Some(sdk_version.to_string()),
        generation,
        reason: "sdk-actor-test".to_string(),
    }
}
