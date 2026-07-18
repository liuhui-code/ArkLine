use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus};
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_incremental_persistence_service::{
    persist_incremental_sqlite_deep_state_with_priority,
    persist_incremental_sqlite_file_symbol_state,
    persist_incremental_sqlite_index_state_with_priority,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;

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

#[test]
fn stub_prepare_does_not_wait_for_the_sqlite_writer() {
    let root = unique_temp_dir("stub-prepare-outside-writer");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "export class EntryController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    let (writer_ready_tx, writer_ready_rx) = mpsc::channel();
    let (release_writer_tx, release_writer_rx) = mpsc::channel();
    let writer_root = root_path.clone();
    let writer = thread::spawn(move || {
        with_workspace_index_writer(&writer_root, |_connection| {
            writer_ready_tx.send(()).unwrap();
            release_writer_rx.recv().unwrap();
            Ok(())
        })
        .unwrap();
    });
    writer_ready_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("writer should acquire its gate");

    let (prepared_tx, prepared_rx) = mpsc::channel();
    let prepare_root = root_path.clone();
    let source_path = source.to_string_lossy().to_string();
    let prepare = thread::spawn(move || {
        let prepared = prepare_changed_stub_rows(
            &prepare_root,
            &[source_path],
            &[],
            1,
            WorkspaceIndexTaskPriority::Background,
        );
        prepared_tx.send(prepared).unwrap();
    });

    let prepared = prepared_rx.recv_timeout(Duration::from_secs(2));
    release_writer_tx.send(()).unwrap();
    writer.join().unwrap();
    prepare.join().unwrap();

    assert_eq!(
        prepared
            .expect("prepare must not wait for writer")
            .stubs
            .len(),
        1
    );
    fs::remove_dir_all(root).unwrap();
}
