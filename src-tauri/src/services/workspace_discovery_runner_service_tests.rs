use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_discovery_runner_service::{
    run_workspace_discovery_chunk, run_workspace_discovery_chunk_with_journal,
};
use crate::services::workspace_discovery_store_service::load_discovered_files;
use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn discovery_runner_persists_chunk_and_running_state() {
    let root = unique_temp_dir("workspace-discovery-runner-running");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(root.join("entry").join("B.ets"), "struct B {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    let result = run_workspace_discovery_chunk(&root, None, 1, 9).unwrap();
    let loaded = load_discovered_files(&root_path, 10).unwrap();

    assert_eq!(result.files.len(), 1);
    assert!(result.has_more);
    assert!(result.cursor.is_some());
    assert_eq!(loaded.len(), 1);
    assert_eq!(stored_state_status(&root), "running");
    assert_eq!(stored_state_generation(&root), 9);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_runner_resumes_and_marks_ready() {
    let root = unique_temp_dir("workspace-discovery-runner-ready");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(root.join("entry").join("B.ets"), "struct B {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    let first = run_workspace_discovery_chunk(&root, None, 1, 11).unwrap();
    let second = run_workspace_discovery_chunk(&root, first.cursor, 10, 11).unwrap();
    let loaded = load_discovered_files(&root_path, 10).unwrap();

    assert_eq!(second.files.len(), 1);
    assert!(!second.has_more);
    assert_eq!(loaded.len(), 2);
    assert_eq!(stored_state_status(&root), "ready");
    assert_eq!(stored_discovered_count(&root), 2);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_runner_returns_durable_cursor_for_a_replayed_chunk() {
    let root = unique_temp_dir("workspace-discovery-runner-replay");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(root.join("entry/B.ets"), "struct B {}\n").unwrap();

    let first = run_workspace_discovery_chunk(&root, None, 1, 12).unwrap();
    let replay = run_workspace_discovery_chunk(&root, None, 1, 12).unwrap();

    assert!(replay.files.is_empty());
    assert_eq!(replay.cursor, first.cursor);
    assert!(replay.has_more);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_runner_rejects_an_older_generation() {
    let root = unique_temp_dir("workspace-discovery-runner-stale");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    run_workspace_discovery_chunk(&root, None, 10, 20).unwrap();

    let error = run_workspace_discovery_chunk(&root, None, 10, 19).unwrap_err();

    assert!(error.contains("Stale discovery generation"));
    assert_eq!(stored_state_generation(&root), 20);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn ready_generation_prunes_files_removed_since_the_previous_scan() {
    let root = unique_temp_dir("workspace-discovery-runner-prune");
    fs::create_dir_all(&root).unwrap();
    let removed = root.join("Removed.ets");
    fs::write(&removed, "struct Removed {}\n").unwrap();
    fs::write(root.join("Kept.ets"), "struct Kept {}\n").unwrap();
    run_workspace_discovery_chunk(&root, None, 10, 30).unwrap();
    fs::remove_file(removed).unwrap();

    run_workspace_discovery_chunk(&root, None, 10, 31).unwrap();
    let loaded = load_discovered_files(&root.to_string_lossy(), 10).unwrap();

    assert_eq!(loaded.len(), 1);
    assert!(loaded[0].ends_with("Kept.ets"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn journal_failure_rolls_back_discovery_files_and_cursor() {
    let root = unique_temp_dir("workspace-discovery-runner-atomic");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    migrate_workspace_index_schema(&root_path).unwrap();
    Connection::open(sqlite_path(&root))
        .unwrap()
        .execute_batch(
            "create trigger reject_discovery_journal
             before insert on workspace_index_task_journal
             begin select raise(abort, 'journal rejected'); end;",
        )
        .unwrap();

    let error = run_workspace_discovery_chunk_with_journal(&root, None, 10, 40, "atomic-discovery")
        .unwrap_err();
    let connection = Connection::open(sqlite_path(&root)).unwrap();

    assert!(error.contains("journal rejected"));
    assert_eq!(table_count(&connection, "workspace_discovered_files"), 0);
    assert_eq!(table_count(&connection, "workspace_discovery_state"), 0);
    assert_eq!(table_count(&connection, "workspace_index_task_journal"), 0);
    fs::remove_dir_all(root).unwrap();
}

fn sqlite_path(root: &PathBuf) -> PathBuf {
    root.join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn stored_state_status(root: &PathBuf) -> String {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row("select status from workspace_discovery_state", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn stored_state_generation(root: &PathBuf) -> i64 {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row(
            "select generation from workspace_discovery_state",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn stored_discovered_count(root: &PathBuf) -> i64 {
    Connection::open(sqlite_path(root))
        .unwrap()
        .query_row(
            "select discovered_count from workspace_discovery_state",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn table_count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("select count(*) from {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}
