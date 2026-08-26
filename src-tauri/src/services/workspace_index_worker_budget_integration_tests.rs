use std::fs;

use crate::services::workspace_index_adaptive_chunk_service::initial_refresh_limits;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_catalog_refresh_worker_service::CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE;
use crate::services::workspace_index_deep_refresh_cursor_service::{
    load_deep_refresh_cursor, WorkspaceIndexDeepRefreshPhase,
};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_budget_service::WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET;
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
    assert!(results[0].refresh_result.is_none());
    assert!(results[0].refresh_continuation.is_none());
    assert_eq!(
        results[0].message.as_deref(),
        Some(CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE)
    );
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

    assert!(results[0].refresh_result.is_none());
    assert!(results[0].refresh_continuation.is_none());
    assert_eq!(
        results[0].message.as_deref(),
        Some(CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_exhausts_its_catalog_before_the_stub_phase_starts() {
    let root = create_empty_workspace("worker-deep-stub-yield");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let changed_paths = (0..initial_refresh_limits(false).0)
        .map(|index| {
            let path = source_dir.join(format!("Pair{index}.ets"));
            fs::write(&path, format!("export class Pair{index} {{}}\n")).unwrap();
            path.to_string_lossy().to_string()
        })
        .collect::<Vec<_>>();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    run_index_tasks(&runtime, vec![deep_task(&root_path, changed_paths)], |_| {
        Ok(())
    })
    .unwrap();
    let before = load_deep_refresh_cursor(&root_path, "full-refresh-deep:refresh-workspace")
        .unwrap()
        .unwrap();
    assert_eq!(before.phase, WorkspaceIndexDeepRefreshPhase::Content);

    let waiting = deep_task(&root_path, Vec::new());
    let token = WorkspaceIndexCancellationToken::new(waiting.generation);
    let progressed = run_index_tasks_with_cancellation_and_ui_activity(
        &runtime,
        vec![(waiting, token)],
        |_| Ok(()),
        || true,
    )
    .unwrap();
    let after = load_deep_refresh_cursor(&root_path, "full-refresh-deep:refresh-workspace")
        .unwrap()
        .unwrap();

    assert_eq!(
        progressed[0].message.as_deref(),
        Some(CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE)
    );
    assert!(progressed[0].refresh_result.is_none());
    assert_eq!(after.phase, WorkspaceIndexDeepRefreshPhase::Stub);
    assert_eq!(after.last_file_id, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn catalog_transitions_to_stub_only_after_content_is_exhausted() {
    let root = create_empty_workspace("worker-deep-catalog-pair");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let first = source_dir.join("First.ets");
    let second = source_dir.join("Second.ets");
    fs::write(&first, "export class FirstController {}\n").unwrap();
    fs::write(&second, "export class SecondController {}\n").unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let first_result = run_index_tasks(
        &runtime,
        vec![deep_task(
            &root_path,
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ],
        )],
        |_| Ok(()),
    )
    .unwrap();
    let mut continuation = deep_task(&root_path, Vec::new());
    continuation.generation = 10;
    let second_result = run_index_tasks(&runtime, vec![continuation], |_| Ok(())).unwrap();

    assert_eq!(first_result[0].status, "partial");
    assert_eq!(second_result[0].status, "partial");
    let cursor = load_deep_refresh_cursor(&root_path, "full-refresh-deep:refresh-workspace")
        .unwrap()
        .unwrap();
    assert_eq!(cursor.phase, WorkspaceIndexDeepRefreshPhase::Stub);
    assert_eq!(cursor.last_file_id, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn catalog_deep_refresh_reports_monotonic_pipeline_progress() {
    let root = create_empty_workspace("worker-deep-progress");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let paths = ["First.ets", "Second.ets"]
        .into_iter()
        .map(|name| {
            let path = source_dir.join(name);
            fs::write(
                &path,
                format!("export class {} {{}}\n", name.trim_end_matches(".ets")),
            )
            .unwrap();
            path.to_string_lossy().to_string()
        })
        .collect::<Vec<_>>();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let content =
        run_index_tasks(&runtime, vec![deep_task(&root_path, paths)], |_| Ok(())).unwrap();
    let phase_transition = run_index_tasks(
        &runtime,
        vec![deep_task(&root_path, Vec::new())],
        |_| Ok(()),
    )
    .unwrap();
    let stub = run_index_tasks(
        &runtime,
        vec![deep_task(&root_path, Vec::new())],
        |_| Ok(()),
    )
    .unwrap();

    assert_eq!(
        (content[0].progress_current, content[0].progress_total),
        (2, 6)
    );
    assert_eq!(
        (
            phase_transition[0].progress_current,
            phase_transition[0].progress_total
        ),
        (2, 6)
    );
    assert_eq!((stub[0].progress_current, stub[0].progress_total), (4, 6));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn catalog_runs_full_content_stub_and_substring_stages_in_order() {
    let root = create_empty_workspace("worker-deep-stage-order");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let source = source_dir.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    run_index_tasks(
        &runtime,
        vec![deep_task(
            &root_path,
            vec![source.to_string_lossy().to_string()],
        )],
        |_| Ok(()),
    )
    .unwrap();
    let mut continuation = deep_task(&root_path, Vec::new());
    for expected in [
        WorkspaceIndexDeepRefreshPhase::Stub,
        WorkspaceIndexDeepRefreshPhase::Stub,
        WorkspaceIndexDeepRefreshPhase::Substring,
        WorkspaceIndexDeepRefreshPhase::Substring,
    ] {
        run_index_tasks(&runtime, vec![continuation.clone()], |_| Ok(())).unwrap();
        let cursor = load_deep_refresh_cursor(&root_path, "full-refresh-deep:refresh-workspace")
            .unwrap()
            .unwrap();
        assert_eq!(cursor.phase, expected);
        continuation.generation = continuation.generation.saturating_add(1);
    }
    run_index_tasks(&runtime, vec![continuation], |_| Ok(())).unwrap();
    assert!(
        load_deep_refresh_cursor(&root_path, "full-refresh-deep:refresh-workspace")
            .unwrap()
            .is_none()
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
