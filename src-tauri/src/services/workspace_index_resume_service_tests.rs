use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_resume_service::{
    clear_resume_tasks_for_root, load_resume_tasks, save_resume_task,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
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
