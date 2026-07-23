use std::fs;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::{
    prepare_workspace_index_compaction, remove_workspace_index_compaction_candidate,
    WorkspaceIndexCompactionCommit,
};
use crate::services::workspace_index_connection_service::WorkspaceIndexConnectionManager;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

#[test]
fn compaction_preserves_rows_and_advances_the_store_generation() {
    let root = test_root("apply");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexConnectionManager::new(1);
    create_fragmented_store(&manager, &root_path);
    assert!(manager.quiesce_compaction_store(&root_path).unwrap());
    let candidate = prepare_workspace_index_compaction(&root_path, || false)
        .unwrap()
        .unwrap();

    let outcome = manager
        .commit_compaction_candidate(&root_path, &candidate)
        .unwrap();

    assert!(
        matches!(
            outcome,
            WorkspaceIndexCompactionCommit::Applied { generation: 1, .. }
        ),
        "unexpected compaction outcome: {outcome:?}"
    );
    let reader = manager.open_existing_reader(&root_path).unwrap().unwrap();
    let count: i64 = reader
        .query_row("select count(*) from compaction_sample", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    drop(reader);
    manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compaction_defers_while_a_reader_is_active() {
    let root = test_root("reader");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexConnectionManager::new(1);
    create_fragmented_store(&manager, &root_path);
    assert!(manager.quiesce_compaction_store(&root_path).unwrap());
    let candidate = prepare_workspace_index_compaction(&root_path, || false)
        .unwrap()
        .unwrap();
    let reader = manager.open_existing_reader(&root_path).unwrap().unwrap();

    let outcome = manager
        .commit_compaction_candidate(&root_path, &candidate)
        .unwrap();

    assert_eq!(
        outcome,
        WorkspaceIndexCompactionCommit::DeferredReadersActive
    );
    assert!(std::path::Path::new(&candidate.path).is_file());
    drop(reader);
    remove_workspace_index_compaction_candidate(&candidate);
    manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compaction_rejects_a_candidate_after_a_new_write() {
    let root = test_root("stale");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexConnectionManager::new(0);
    create_fragmented_store(&manager, &root_path);
    assert!(manager.quiesce_compaction_store(&root_path).unwrap());
    let candidate = prepare_workspace_index_compaction(&root_path, || false)
        .unwrap()
        .unwrap();
    manager
        .with_writer(&root_path, |connection| {
            connection
                .execute("insert into compaction_sample values(2, 'new')", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

    let outcome = manager
        .commit_compaction_candidate(&root_path, &candidate)
        .unwrap();

    assert_eq!(
        outcome,
        WorkspaceIndexCompactionCommit::DeferredSourceChanged
    );
    remove_workspace_index_compaction_candidate(&candidate);
    manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compaction_waits_for_an_active_writer_and_rejects_its_stale_candidate() {
    let root = test_root("active-writer");
    let root_path = root.to_string_lossy().to_string();
    let manager = Arc::new(WorkspaceIndexConnectionManager::new(0));
    create_fragmented_store(&manager, &root_path);
    assert!(manager.quiesce_compaction_store(&root_path).unwrap());
    let candidate = prepare_workspace_index_compaction(&root_path, || false)
        .unwrap()
        .unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let writer = {
        let manager = Arc::clone(&manager);
        let root_path = root_path.clone();
        thread::spawn(move || {
            manager
                .with_writer(&root_path, |connection| {
                    started_tx.send(()).unwrap();
                    thread::sleep(Duration::from_millis(75));
                    connection
                        .execute("insert into compaction_sample values(2, 'new')", [])
                        .map(|_| ())
                        .map_err(|error| error.to_string())
                })
                .unwrap();
        })
    };
    started_rx.recv().unwrap();

    let started = Instant::now();
    let outcome = manager
        .commit_compaction_candidate(&root_path, &candidate)
        .unwrap();

    assert!(started.elapsed() >= Duration::from_millis(50));
    assert_eq!(
        outcome,
        WorkspaceIndexCompactionCommit::DeferredSourceChanged
    );
    writer.join().unwrap();
    remove_workspace_index_compaction_candidate(&candidate);
    manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compaction_can_be_cancelled_before_copying() {
    let root = test_root("cancel");
    let root_path = root.to_string_lossy().to_string();
    let manager = WorkspaceIndexConnectionManager::new(0);
    create_fragmented_store(&manager, &root_path);
    assert!(manager.quiesce_compaction_store(&root_path).unwrap());

    let candidate = prepare_workspace_index_compaction(&root_path, || true).unwrap();

    assert!(candidate.is_none());
    manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

fn create_fragmented_store(manager: &WorkspaceIndexConnectionManager, root_path: &str) {
    manager
        .with_writer(root_path, |connection| {
            ensure_workspace_index_schema(connection)?;
            connection
                .execute_batch(
                    "create table compaction_sample(
                         id integer primary key,
                         value text not null
                     );
                     insert into compaction_sample values(1, 'keep');",
                )
                .map_err(|error| error.to_string())?;
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            {
                let mut statement = transaction
                    .prepare("insert into compaction_sample values(?1, ?2)")
                    .map_err(|error| error.to_string())?;
                let payload = "x".repeat(4_096);
                for id in 2..1_000 {
                    statement
                        .execute((id, &payload))
                        .map_err(|error| error.to_string())?;
                }
            }
            transaction.commit().map_err(|error| error.to_string())?;
            connection
                .execute("delete from compaction_sample where id > 1", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
}

fn test_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "arkline-compaction-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    root
}
