use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_resume_service::{
    clear_completed_resume_tasks, clear_resume_tasks_for_root, load_resume_tasks, save_resume_task,
    schedule_interrupted_resume_tasks,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_task_status_service::{
    superseded_task_result_from_task, WorkspaceIndexTaskResult,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn continuation_task(root_path: &str, paths: &[&str], generation: u64) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::FullRefresh,
        changed_paths: paths.iter().map(|path| path.to_string()).collect(),
        sdk_path: None,
        sdk_version: None,
        generation,
        reason: "full-refresh-continuation:refresh-workspace".to_string(),
    }
}

fn continuation_task_with_reason(
    root_path: &str,
    paths: &[&str],
    generation: u64,
    reason: &str,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        reason: reason.to_string(),
        ..continuation_task(root_path, paths, generation)
    }
}

#[test]
fn saves_and_loads_resume_task() {
    let root = unique_temp_dir("workspace-index-resume-save");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let task = continuation_task(&root_path, &["A.ets", "B.ets"], 7);

    save_resume_task(&root_path, &task).unwrap();
    let tasks = load_resume_tasks(&root_path).unwrap();

    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].kind, WorkspaceIndexTaskKind::ChangedPaths);
    assert_eq!(tasks[0].priority, WorkspaceIndexTaskPriority::FullRefresh);
    assert_eq!(tasks[0].changed_paths, vec!["A.ets", "B.ets"]);
    assert_eq!(tasks[0].generation, 7);
    assert_eq!(
        tasks[0].reason,
        "full-refresh-continuation:refresh-workspace"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn replaces_existing_resume_task_for_same_root_kind_and_reason() {
    let root = unique_temp_dir("workspace-index-resume-replace");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();

    save_resume_task(&root_path, &continuation_task(&root_path, &["A.ets"], 7)).unwrap();
    save_resume_task(&root_path, &continuation_task(&root_path, &["B.ets"], 8)).unwrap();
    let tasks = load_resume_tasks(&root_path).unwrap();

    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].changed_paths, vec!["B.ets"]);
    assert_eq!(tasks[0].generation, 8);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn clears_resume_tasks_for_root() {
    let root = unique_temp_dir("workspace-index-resume-clear");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();

    save_resume_task(&root_path, &continuation_task(&root_path, &["A.ets"], 7)).unwrap();
    clear_resume_tasks_for_root(&root_path).unwrap();

    assert!(load_resume_tasks(&root_path).unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn clears_completed_file_layer_resume_task() {
    let root = unique_temp_dir("workspace-index-resume-clear-file-layer");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let reason = "full-refresh-files:refresh-workspace";
    save_resume_task(
        &root_path,
        &continuation_task_with_reason(&root_path, &["A.ets"], 7, reason),
    )
    .unwrap();

    clear_completed_resume_tasks(&[WorkspaceIndexTaskResult {
        root_path: root_path.clone(),
        kind: "changed-paths".to_string(),
        status: "ready".to_string(),
        reason: reason.to_string(),
        generation: 7,
        started_at: Some(100),
        finished_at: Some(200),
        message: None,
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    }])
    .unwrap();

    assert!(load_resume_tasks(&root_path).unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn requeues_persisted_continuation_after_interrupted_result_once() {
    let root = unique_temp_dir("workspace-index-resume-interrupted");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let reason = "full-refresh-deep:refresh-workspace";
    let task = continuation_task_with_reason(&root_path, &["A.ets"], 7, reason);
    save_resume_task(&root_path, &task).unwrap();
    let scheduler = Arc::new(Mutex::new(WorkspaceIndexScheduler::default()));
    let result = superseded_task_result_from_task(&task);

    let first = schedule_interrupted_resume_tasks(&scheduler, std::slice::from_ref(&result))
        .expect("interrupted continuation should be recovered");
    let second = schedule_interrupted_resume_tasks(&scheduler, &[result])
        .expect("existing continuation should not be duplicated");
    let pending = scheduler.lock().unwrap().pending_tasks_for_root(&root_path);

    assert_eq!(first.root_paths, vec![root_path.clone()]);
    assert!(second.root_paths.is_empty());
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].reason, reason);
    assert_eq!(pending[0].changed_paths, vec!["A.ets"]);

    fs::remove_dir_all(root).unwrap();
}
