use std::fs;

use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_budget_service::{
    WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET, WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET,
};
use crate::services::workspace_index_worker_service::{
    run_index_tasks, run_index_tasks_with_cancellation_and_ui_activity,
};

#[test]
fn worker_background_deep_continuation_defers_paths_over_budget() {
    let root = create_empty_workspace("worker-deep-budget");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let mut changed_paths = Vec::new();

    for index in 0..(WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 1) {
        let path = source_dir.join(format!("Deep{index}.ets"));
        fs::write(&path, format!("struct Deep{index} {{}}\n")).unwrap();
        changed_paths.push(path.to_string_lossy().to_string());
    }
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let results = run_index_tasks(&runtime, vec![deep_task(&root_path, changed_paths)], |_| {
        Ok(())
    })
    .unwrap();

    assert_eq!(results[0].status, "partial");
    assert_eq!(
        results[0]
            .refresh_result
            .as_ref()
            .unwrap()
            .added_paths
            .len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET
    );
    assert_eq!(
        results[0]
            .refresh_continuation
            .as_ref()
            .unwrap()
            .remaining_paths()
            .len(),
        1
    );
    let message = results[0].message.as_deref().unwrap();
    assert!(message.contains("128 file(s)"));
    assert!(message.contains("1 file(s) deferred"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_background_deep_continuation_uses_ui_active_budget() {
    let root = create_empty_workspace("worker-deep-ui-budget");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let mut changed_paths = Vec::new();

    for index in 0..WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET {
        let path = source_dir.join(format!("UiDeep{index}.ets"));
        fs::write(&path, format!("struct UiDeep{index} {{}}\n")).unwrap();
        changed_paths.push(path.to_string_lossy().to_string());
    }
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let task = deep_task(&root_path, changed_paths);
    let token = WorkspaceIndexCancellationToken::new(task.generation);
    let results = run_index_tasks_with_cancellation_and_ui_activity(
        &runtime,
        vec![(task, token)],
        |_| Ok(()),
        || true,
    )
    .unwrap();

    assert_eq!(
        results[0]
            .refresh_result
            .as_ref()
            .unwrap()
            .added_paths
            .len(),
        WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET
    );
    assert_eq!(
        results[0]
            .refresh_continuation
            .as_ref()
            .unwrap()
            .remaining_paths()
            .len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET - WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET
    );
    fs::remove_dir_all(root).unwrap();
}

fn deep_task(root_path: &str, changed_paths: Vec<String>) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Background,
        changed_paths,
        sdk_path: None,
        sdk_version: None,
        generation: 9,
        reason: "full-refresh-deep:refresh-workspace".to_string(),
    }
}
