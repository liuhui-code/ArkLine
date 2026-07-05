use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_discovery_runner_service::run_workspace_discovery_chunk;
use crate::services::workspace_discovery_store_service::load_discovered_files;

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
