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
    for index in 0..WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE {
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
    assert!(results[0].refresh_continuation.is_some());
    assert_eq!(resume_tasks.len(), 1);
    assert_eq!(resume_tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(
        resume_tasks[0].reason,
        "full-refresh-continuation:refresh-workspace"
    );
    assert!(statuses.iter().any(|status| {
        status.kind == "changed-paths"
            && status.status == "queued"
            && status.reason == "full-refresh-continuation:refresh-workspace"
    }));

    let continuation_results = manager
        .run_index_worker_once(&index_runtime, |_| {})
        .unwrap();
    let state = index_runtime.get_index_state(&root_path).unwrap();

    assert_eq!(continuation_results.len(), 1);
    assert_eq!(continuation_results[0].kind, "changed-paths");
    assert_eq!(continuation_results[0].status, "ready");
    assert!(load_resume_tasks(&root_path).unwrap().is_empty());
    assert_eq!(
        state.file_paths.len(),
        WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE + 1
    );

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
