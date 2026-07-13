use std::fs;

use rusqlite::Connection;

use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::{
    run_index_tasks, WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE,
};

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
fn worker_empty_changed_paths_skips_without_creating_index_store() {
    let root = create_empty_workspace("worker-empty-changed-paths");
    let task = WorkspaceIndexTask {
        root_path: root.to_string_lossy().to_string(),
        kind: WorkspaceIndexTaskKind::ChangedPaths,
        priority: WorkspaceIndexTaskPriority::Normal,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 3,
        reason: "watcher".to_string(),
    };

    let results =
        run_index_tasks(&WorkspaceIndexRuntime::default(), vec![task], |_| Ok(())).unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].kind, "changed-paths");
    assert_eq!(results[0].status, "skipped");
    assert!(!root.join(".arkline").exists());

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
