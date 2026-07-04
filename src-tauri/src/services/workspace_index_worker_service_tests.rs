use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::{
    run_index_tasks, run_index_tasks_with_cancellation, WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE,
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
fn worker_open_workspace_uses_lightweight_index_before_deep_refresh() {
    let root = create_empty_workspace("worker-open-light-index");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::write(
        source_dir.join("Index.ets"),
        "export class OpenLightController {}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::OpenWorkspace,
        priority: WorkspaceIndexTaskPriority::ForegroundNavigation,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 9,
        reason: "open-workspace".to_string(),
    };

    let results = run_index_tasks(&runtime, vec![task], |_| Ok(())).unwrap();

    assert_eq!(results[0].kind, "open-workspace");
    assert_eq!(results[0].status, "ready");
    assert_eq!(
        runtime
            .query_quick_open(&root_path, "OpenLight", 8)
            .unwrap()[0]
            .title,
        "Index.ets"
    );
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stub_count, 0);

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

#[test]
fn worker_changed_paths_reindexes_reverse_dependencies() {
    let root = create_empty_workspace("worker-dependency-expansion");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let page_dir = source_dir.join("pages");
    let model_dir = source_dir.join("model");
    fs::create_dir_all(&page_dir).unwrap();
    fs::create_dir_all(&model_dir).unwrap();
    let profile_file = page_dir.join("Profile.ets");
    let user_file = model_dir.join("User.ets");
    fs::write(
        &profile_file,
        "import { User } from \"../model/User\";\nstruct ProfilePage {}\n",
    )
    .unwrap();
    fs::write(&user_file, "export class User {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let sqlite_path = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    install_profile_delete_probe(
        &sqlite_path,
        &profile_file.to_string_lossy().replace('/', "\\"),
    );
    fs::write(&user_file, "export class User { name: string }\n").unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: vec![user_file.to_string_lossy().to_string()],
        sdk_path: None,
        sdk_version: None,
        generation: 3,
        reason: "watcher".to_string(),
    };

    let results = run_index_tasks(&runtime, vec![task], |_| Ok(())).unwrap();

    assert_eq!(results[0].status, "ready");
    assert_eq!(profile_delete_probe_count(&sqlite_path), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_changed_paths_processes_all_chunks_without_dropping_added_files() {
    let root = create_empty_workspace("worker-changed-path-chunks");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let mut changed_paths = Vec::new();

    for index in 0..(WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE + 1) {
        let path = source_dir.join(format!("Chunk{index}.ets"));
        fs::write(&path, format!("struct Chunk{index} {{}}\n")).unwrap();
        changed_paths.push(path.to_string_lossy().to_string());
    }
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths,
        sdk_path: None,
        sdk_version: None,
        generation: 8,
        reason: "watcher".to_string(),
    };

    let results = run_index_tasks(&runtime, vec![task], |_| Ok(())).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].status, "ready");
    let refresh = results[0].refresh_result.as_ref().unwrap();
    assert_eq!(
        refresh.added_paths.len(),
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE + 1
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_config_change_runs_config_change_refresh() {
    let root = create_empty_workspace("worker-config-change");
    let config_path = root.join("oh-package.json5");
    fs::write(&config_path, "{ name: \"demo\" }\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::write(&config_path, "{ name: \"demo-next\" }\n").unwrap();
    let task = WorkspaceIndexTask {
        root_path: root_path.clone(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: vec![config_path.to_string_lossy().to_string()],
        sdk_path: None,
        sdk_version: None,
        generation: 4,
        reason: "watcher".to_string(),
    };

    let results = run_index_tasks(&runtime, vec![task], |_| Ok(())).unwrap();

    assert_eq!(results[0].kind, "config-change");
    assert_eq!(results[0].reason, "config-change");
    assert_eq!(results[0].status, "ready");

    fs::remove_dir_all(root).unwrap();
}

fn install_profile_delete_probe(sqlite_path: &std::path::Path, profile_path: &str) {
    let connection = rusqlite::Connection::open(sqlite_path).unwrap();
    connection
        .execute("create table profile_delete_probe (name text not null)", [])
        .unwrap();
    connection
        .execute(
            &format!(
                "create trigger profile_delete_probe_trigger
                 before delete on workspace_stub_declarations
                 when old.path = '{}' and old.name = 'ProfilePage'
                 begin
                    insert into profile_delete_probe (name) values (old.name);
                 end",
                profile_path.replace('\'', "''"),
            ),
            [],
        )
        .unwrap();
}

fn profile_delete_probe_count(sqlite_path: &std::path::Path) -> i64 {
    rusqlite::Connection::open(sqlite_path)
        .unwrap()
        .query_row("select count(*) from profile_delete_probe", [], |row| {
            row.get(0)
        })
        .unwrap()
}
