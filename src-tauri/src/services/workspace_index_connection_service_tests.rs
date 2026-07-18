use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_connection_service::WorkspaceIndexConnectionManager;

#[test]
fn configures_workspace_store_for_concurrent_reads() {
    let root = unique_temp_dir("workspace-index-wal");
    let manager = WorkspaceIndexConnectionManager::new(1);
    manager
        .with_writer(root_str(&root), |connection| {
            connection
                .execute_batch("create table sample(value integer); insert into sample values(1);")
                .map_err(|error| error.to_string())
        })
        .unwrap();

    let reader = manager
        .open_existing_reader(root_str(&root))
        .unwrap()
        .unwrap();
    let journal_mode: String = reader
        .query_row("pragma journal_mode", [], |row| row.get(0))
        .unwrap();
    let busy_timeout_ms: i64 = reader
        .query_row("pragma busy_timeout", [], |row| row.get(0))
        .unwrap();
    let synchronous: i64 = reader
        .query_row("pragma synchronous", [], |row| row.get(0))
        .unwrap();
    let query_only: i64 = reader
        .query_row("pragma query_only", [], |row| row.get(0))
        .unwrap();

    assert_eq!(journal_mode, "wal");
    assert!(busy_timeout_ms >= 5_000);
    assert_eq!(synchronous, 1);
    assert_eq!(query_only, 1);
    drop(reader);
    manager.clear(root_str(&root)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serializes_writers_for_the_same_workspace() {
    let root = unique_temp_dir("workspace-index-writer-gate");
    let manager = Arc::new(WorkspaceIndexConnectionManager::new(0));
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();

    for _ in 0..4 {
        let manager = Arc::clone(&manager);
        let active = Arc::clone(&active);
        let maximum = Arc::clone(&maximum);
        let root_path = root.to_string_lossy().to_string();
        workers.push(thread::spawn(move || {
            manager
                .with_writer(&root_path, |_| {
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(current, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(15));
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap();
        }));
    }
    for worker in workers {
        worker.join().unwrap();
    }

    assert_eq!(maximum.load(Ordering::SeqCst), 1);
    let metrics = manager.writer_metrics(root_str(&root));
    assert_eq!(metrics.sample_count, 4);
    assert_eq!(metrics.active_writer_count, 0);
    assert_eq!(metrics.queued_writer_count, 0);
    assert_eq!(metrics.failure_count, 0);
    assert!(metrics.hold_p95_us >= 15_000);
    assert!(metrics.wait_max_us >= 10_000);
    manager.clear(root_str(&root)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reuses_readers_up_to_the_configured_bound() {
    let root = unique_temp_dir("workspace-index-reader-pool");
    let manager = WorkspaceIndexConnectionManager::new(1);
    manager.with_writer(root_str(&root), |_| Ok(())).unwrap();

    let reader = manager
        .open_existing_reader(root_str(&root))
        .unwrap()
        .unwrap();
    assert_eq!(manager.pooled_reader_count(root_str(&root)), 0);
    drop(reader);
    assert_eq!(manager.pooled_reader_count(root_str(&root)), 1);

    let reader = manager
        .open_existing_reader(root_str(&root))
        .unwrap()
        .unwrap();
    assert_eq!(manager.pooled_reader_count(root_str(&root)), 0);
    drop(reader);
    manager.clear(root_str(&root)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn does_not_reapply_wal_while_an_existing_reader_is_active() {
    let root = unique_temp_dir("workspace-index-active-reader");
    let manager = WorkspaceIndexConnectionManager::new(1);
    manager
        .with_writer(root_str(&root), |connection| {
            connection
                .execute_batch("create table sample(value integer); insert into sample values(1);")
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let reader = manager
        .open_existing_reader(root_str(&root))
        .unwrap()
        .unwrap();
    reader.execute_batch("begin").unwrap();
    let _: i64 = reader
        .query_row("select value from sample", [], |row| row.get(0))
        .unwrap();

    let started = Instant::now();
    manager
        .with_writer(root_str(&root), |connection| {
            connection
                .execute("insert into sample values(2)", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

    assert!(started.elapsed() < Duration::from_millis(500));
    reader.execute_batch("rollback").unwrap();
    drop(reader);
    manager.clear(root_str(&root)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn records_failed_writer_operations_without_leaking_active_or_queued_counts() {
    let root = unique_temp_dir("workspace-index-writer-failure-metrics");
    let manager = WorkspaceIndexConnectionManager::new(0);

    let result = manager.with_writer(root_str(&root), |_| Err::<(), _>("failed".to_string()));

    assert_eq!(result.unwrap_err(), "failed");
    let metrics = manager.writer_metrics(root_str(&root));
    assert_eq!(metrics.sample_count, 1);
    assert_eq!(metrics.failure_count, 1);
    assert_eq!(metrics.active_writer_count, 0);
    assert_eq!(metrics.queued_writer_count, 0);
    manager.clear(root_str(&root)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serializes_publication_across_independent_connection_managers() {
    let root = unique_temp_dir("workspace-index-cross-process-transaction");
    let first_manager = Arc::new(WorkspaceIndexConnectionManager::new(0));
    let second_manager = Arc::new(WorkspaceIndexConnectionManager::new(0));
    first_manager
        .with_writer(root_str(&root), |connection| {
            connection
                .execute_batch("create table publication(value integer)")
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let root_path = root.to_string_lossy().to_string();

    let first = {
        let manager = Arc::clone(&first_manager);
        let active = Arc::clone(&active);
        let maximum = Arc::clone(&maximum);
        let root_path = root_path.clone();
        thread::spawn(move || {
            manager
                .with_immediate_transaction(
                    &root_path,
                    |_| Ok(()),
                    |_| {
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(current, Ordering::SeqCst);
                        started_tx.send(()).unwrap();
                        thread::sleep(Duration::from_millis(75));
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .unwrap();
        })
    };
    started_rx.recv().unwrap();
    let second = {
        let manager = Arc::clone(&second_manager);
        let active = Arc::clone(&active);
        let maximum = Arc::clone(&maximum);
        let root_path = root_path.clone();
        thread::spawn(move || {
            manager
                .with_immediate_transaction(
                    &root_path,
                    |_| Ok(()),
                    |_| {
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(current, Ordering::SeqCst);
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .unwrap();
        })
    };
    first.join().unwrap();
    second.join().unwrap();

    assert_eq!(maximum.load(Ordering::SeqCst), 1);
    assert!(second_manager.writer_metrics(&root_path).wait_max_us >= 50_000);
    first_manager.clear(&root_path).unwrap();
    second_manager.clear(&root_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

fn unique_temp_dir(name: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn root_str(root: &std::path::Path) -> &str {
    root.to_str().unwrap()
}
