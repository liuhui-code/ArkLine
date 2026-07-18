use std::fs;

use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::{
    run_index_tasks, run_index_tasks_with_cancellation,
};

#[test]
fn worker_records_failed_task_result_instead_of_aborting_the_batch() {
    let task = WorkspaceIndexTask {
        root_path: "/workspace".to_string(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: Some("test-sdk".to_string()),
        generation: 7,
        reason: "sdk-apply".to_string(),
    };
    let mut observed = Vec::new();

    let results = run_index_tasks(&WorkspaceIndexRuntime::default(), vec![task], |status| {
        observed.push((status.kind, status.status));
        Ok(())
    })
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "sdk");
    assert_eq!(results[0].status, "failed");
    assert_eq!(results[0].generation, 7);
    assert!(results[0]
        .error
        .as_ref()
        .is_some_and(|error| error.contains("missing sdk path")));
    assert_eq!(observed, vec![("sdk".to_string(), "running".to_string())]);
}

#[test]
fn worker_skips_narrow_tasks_superseded_by_later_tasks_in_the_same_batch() {
    let root = create_empty_workspace("worker-batch-superseded");
    let root_path = root.to_string_lossy().to_string();
    let changed_paths = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: vec![root
            .join("entry/src/main/ets/Index.ets")
            .to_string_lossy()
            .to_string()],
        sdk_path: None,
        sdk_version: None,
        generation: 1,
        reason: "watcher".to_string(),
    };
    let refresh = WorkspaceIndexTask {
        root_path,
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 2,
        reason: "manual".to_string(),
    };
    let mut observed = Vec::new();

    let results = run_index_tasks(
        &WorkspaceIndexRuntime::default(),
        vec![changed_paths, refresh],
        |status| {
            observed.push((status.kind, status.status));
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].kind, "changed-paths");
    assert_eq!(results[0].status, "superseded");
    assert_eq!(results[0].generation, 1);
    assert!(results[0].started_at.is_none());
    assert!(results[0].finished_at.is_some());
    assert_eq!(
        results[0].message.as_deref(),
        Some("Replaced by a newer index task")
    );
    assert!(results[0].error.is_none());
    assert!(results[0].refresh_result.is_none());
    assert_eq!(results[1].kind, "refresh-workspace");
    assert_eq!(results[1].status, "ready");
    assert_eq!(
        observed,
        vec![("refresh-workspace".to_string(), "running".to_string())]
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_keeps_changed_path_tasks_with_different_reasons() {
    let root = create_empty_workspace("worker-batch-independent-reasons");
    let root_path = root.to_string_lossy().to_string();
    let source_path = root
        .join("entry/src/main/ets/Index.ets")
        .to_string_lossy()
        .to_string();
    let mut first = changed_paths_task(&root_path, &source_path, 1, "visible-file");
    first.priority = WorkspaceIndexTaskPriority::VisibleFiles;
    let second = changed_paths_task(&root_path, &source_path, 2, "watcher");

    let results = run_index_tasks(
        &WorkspaceIndexRuntime::default(),
        vec![first, second],
        |_| Ok(()),
    )
    .unwrap();

    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|result| result.status != "superseded"));

    fs::remove_dir_all(root).unwrap();
}

fn changed_paths_task(
    root_path: &str,
    source_path: &str,
    generation: u64,
    reason: &str,
) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: vec![source_path.to_string()],
        sdk_path: None,
        sdk_version: None,
        generation,
        reason: reason.to_string(),
    }
}

#[test]
fn worker_skips_old_sdk_task_superseded_by_later_sdk_in_the_same_batch() {
    let root = create_empty_workspace("worker-batch-sdk-superseded");
    let old_sdk = root.join("old-sdk");
    let new_sdk = root.join("new-sdk");
    fs::create_dir_all(old_sdk.join("ets")).unwrap();
    fs::create_dir_all(new_sdk.join("ets")).unwrap();
    fs::write(
        old_sdk.join("ets").join("old.d.ts"),
        "declare class OldText {\n  width(value: Length): OldText;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk.join("ets").join("new.d.ts"),
        "declare class NewText {\n  height(value: Length): NewText;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let old_sdk_task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: Some(old_sdk.to_string_lossy().to_string()),
        sdk_version: Some("old-sdk".to_string()),
        generation: 1,
        reason: "sdk-apply".to_string(),
    };
    let new_sdk_task = WorkspaceIndexTask {
        root_path,
        kind: WorkspaceIndexTaskKind::IndexSdk,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: Some(new_sdk.to_string_lossy().to_string()),
        sdk_version: Some("new-sdk".to_string()),
        generation: 2,
        reason: "sdk-apply".to_string(),
    };
    let mut observed = Vec::new();

    let results = run_index_tasks(
        &WorkspaceIndexRuntime::default(),
        vec![old_sdk_task, new_sdk_task],
        |status| {
            observed.push((status.kind, status.status));
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].kind, "sdk");
    assert_eq!(results[0].status, "superseded");
    assert_eq!(results[0].generation, 1);
    assert!(results[0].started_at.is_none());
    assert!(results[0].finished_at.is_some());
    assert_eq!(
        results[0].message.as_deref(),
        Some("Replaced by a newer index task")
    );
    assert!(results[0].error.is_none());
    assert_eq!(results[0].sdk_symbol_count, None);
    assert_eq!(results[1].kind, "sdk");
    assert_eq!(results[1].status, "ready");
    assert_eq!(results[1].sdk_symbol_count, Some(2));
    assert_eq!(observed, vec![("sdk".to_string(), "running".to_string())]);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_keeps_batch_tasks_for_different_roots_independent() {
    let first_root = create_empty_workspace("worker-batch-root-a");
    let second_root = create_empty_workspace("worker-batch-root-b");
    let first_path = first_root
        .join("entry/src/main/ets/Index.ets")
        .to_string_lossy()
        .to_string();
    let first_changed_paths = WorkspaceIndexTask {
        root_path: first_root.to_string_lossy().to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: vec![first_path],
        sdk_path: None,
        sdk_version: None,
        generation: 1,
        reason: "watcher".to_string(),
    };
    let second_refresh = WorkspaceIndexTask {
        root_path: second_root.to_string_lossy().to_string(),
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 2,
        reason: "manual".to_string(),
    };
    let mut observed = Vec::new();

    let results = run_index_tasks(
        &WorkspaceIndexRuntime::default(),
        vec![first_changed_paths, second_refresh],
        |status| {
            observed.push((status.kind, status.status));
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].kind, "changed-paths");
    assert_ne!(results[0].status, "superseded");
    assert_eq!(results[1].kind, "refresh-workspace");
    assert_eq!(
        observed,
        vec![
            ("changed-paths".to_string(), "running".to_string()),
            ("refresh-workspace".to_string(), "running".to_string()),
        ]
    );

    fs::remove_dir_all(first_root).unwrap();
    fs::remove_dir_all(second_root).unwrap();
}

#[test]
fn worker_returns_superseded_when_token_is_cancelled_after_running_status() {
    let root = create_empty_workspace("worker-cancelled-token");
    let root_path = root.to_string_lossy().to_string();
    let task = WorkspaceIndexTask {
        root_path,
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 7,
        reason: "manual".to_string(),
    };
    let token = WorkspaceIndexCancellationToken::new(7);
    let token_for_callback = token.clone();

    let results = run_index_tasks_with_cancellation(
        &WorkspaceIndexRuntime::default(),
        vec![(task, token)],
        move |status| {
            if status.status == "running" {
                token_for_callback.cancel();
            }
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "refresh-workspace");
    assert_eq!(results[0].status, "superseded");
    assert!(results[0].refresh_result.is_none());

    fs::remove_dir_all(root).unwrap();
}
