use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus};
use crate::services::workspace_index_incremental_persistence_service::{
    persist_incremental_sqlite_deep_state_with_priority,
    persist_incremental_sqlite_file_symbol_state,
    persist_incremental_sqlite_index_state_with_priority,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn empty_incremental_persistence_skips_sqlite_store_creation() {
    let root = unique_temp_dir("empty-incremental-persistence");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let state = WorkspaceIndexState {
        status: WorkspaceIndexStatus::Ready,
        root_path: Some(root_path.clone()),
        file_paths: Vec::new(),
        symbols: Vec::new(),
        indexed_at: Some(1),
        partial_reason: None,
    };

    persist_incremental_sqlite_index_state_with_priority(
        &root_path,
        &state,
        &[],
        &[],
        &[],
        WorkspaceIndexTaskPriority::ChangedFiles,
    )
    .unwrap();
    persist_incremental_sqlite_file_symbol_state(&root_path, &state, &[], &[], &[]).unwrap();
    persist_incremental_sqlite_deep_state_with_priority(
        &root_path,
        &state,
        &[],
        &[],
        WorkspaceIndexTaskPriority::FullRefresh,
    )
    .unwrap();

    assert!(!root.join(".arkline").exists());
    fs::remove_dir_all(root).unwrap();
}
