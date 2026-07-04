use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_resume_service::{load_resume_tasks, save_resume_task};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_worker_service::WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn worker_runner_requeues_full_refresh_continuation_after_first_chunk() {
    let root = unique_temp_dir("workspace-index-manager-refresh-continuation");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Seed.ets"), "struct Seed {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();
    let added_file_count = WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE * 2 + 1;
    for index in 0..added_file_count {
        fs::write(
            source_dir.join(format!("RefreshContinuation{index}.ets")),
            format!("struct RefreshContinuation{index} {{}}\n"),
        )
        .unwrap();
    }

    manager.refresh_workspace_index(&root_path).unwrap();
    let results = manager
        .run_index_worker_once(&index_runtime, |_| {})
        .unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();
    let resume_tasks = load_resume_tasks(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "refresh-workspace");
    assert_eq!(results[0].status, "partial");
    assert_eq!(results[0].progress_current, 1);
    assert_eq!(results[0].progress_total, 3);
    assert!(results[0].refresh_continuation.is_some());
    assert_eq!(resume_tasks.len(), 2);
    let file_task = resume_tasks
        .iter()
        .find(|task| task.reason == "full-refresh-files:refresh-workspace")
        .expect("file-layer continuation should be resumable");
    let deep_task = resume_tasks
        .iter()
        .find(|task| task.reason == "full-refresh-deep:refresh-workspace")
        .expect("deep-layer continuation should be resumable");
    assert_eq!(file_task.kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(
        file_task.changed_paths.len(),
        added_file_count + 1 - WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE
    );
    assert_eq!(
        deep_task.changed_paths.len(),
        WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE
    );
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "full-refresh-files:refresh-workspace"
    }));

    let second_results = manager
        .run_index_worker_once(&index_runtime, |_| {})
        .unwrap();
    let second_resume_tasks = load_resume_tasks(&root_path).unwrap();

    assert_eq!(second_results.len(), 1);
    assert_eq!(second_results[0].kind, "changed-paths");
    assert_eq!(second_results[0].status, "partial");
    assert_eq!(second_results[0].progress_current, 1);
    assert_eq!(second_results[0].progress_total, 2);
    assert!(second_resume_tasks
        .iter()
        .any(|task| task.reason == "full-refresh-files:refresh-workspace"));
    assert!(second_resume_tasks
        .iter()
        .any(|task| task.reason == "full-refresh-deep:refresh-workspace"));

    let final_results = manager
        .run_index_worker_once(&index_runtime, |_| {})
        .unwrap();
    let state = index_runtime.get_index_state(&root_path).unwrap();

    assert_eq!(final_results.len(), 1);
    assert_eq!(final_results[0].kind, "changed-paths");
    assert!(matches!(
        final_results[0].status.as_str(),
        "ready" | "skipped"
    ));
    assert!(load_resume_tasks(&root_path)
        .unwrap()
        .iter()
        .all(|task| task.reason == "full-refresh-deep:refresh-workspace"));
    assert_eq!(state.file_paths.len(), added_file_count + 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn open_workspace_rehydrates_persisted_resume_tasks() {
    let root = unique_temp_dir("workspace-index-manager-resume-open");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let resumed_file = source_dir.join("Resumed.ets");
    fs::write(&resumed_file, "struct Resumed {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::FullRefresh,
        changed_paths: vec![resumed_file.to_string_lossy().to_string()],
        sdk_path: None,
        sdk_version: None,
        generation: 12,
        reason: "full-refresh-continuation:refresh-workspace".to_string(),
    };
    save_resume_task(&root_path, &task).unwrap();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let statuses = manager.get_index_task_statuses(&root_path).unwrap();

    assert!(statuses
        .iter()
        .any(|status| status.kind == "open-workspace" && status.status == "queued"));
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "full-refresh-continuation:refresh-workspace"
    }));

    fs::remove_dir_all(root).unwrap();
}
