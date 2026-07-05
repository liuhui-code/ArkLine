use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_discovery_store_service::load_discovered_files;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn discovery_continues_until_pending_cursor_is_empty() {
    let root = unique_temp_dir("workspace-discovery-continuation");
    let first_dir = root.join("entry");
    let second_dir = root.join("feature");
    fs::create_dir_all(&first_dir).unwrap();
    fs::create_dir_all(&second_dir).unwrap();
    for index in 0..1024 {
        fs::write(
            first_dir.join(format!("File{index:04}.ets")),
            "struct Item {}\n",
        )
        .unwrap();
    }
    fs::write(second_dir.join("B.ets"), "struct B {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    manager.drain_index_task_results(&index_runtime).unwrap();
    let first_batch = manager.drain_index_task_results(&index_runtime).unwrap();
    let second_batch = manager.drain_index_task_results(&index_runtime).unwrap();
    let discovered_files = load_discovered_files(&root_path, 2000).unwrap();

    assert!(first_batch
        .iter()
        .any(|result| result.reason == "workspace-discovery" && result.status == "partial"));
    assert!(second_batch
        .iter()
        .any(|result| result.reason == "workspace-discovery" && result.status == "ready"));
    assert_eq!(discovered_files.len(), 1025);

    fs::remove_dir_all(root).unwrap();
}
