use std::collections::HashMap;
use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{Connection, Transaction, TransactionBehavior};

use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;
use crate::services::workspace_index_compaction_service::{
    checkpoint_workspace_index_store, commit_workspace_index_compaction,
    WorkspaceIndexCompactionCandidate, WorkspaceIndexCompactionCommit,
};
use crate::services::workspace_index_connection_metrics_service::WorkspaceIndexConnectionMetrics;
#[cfg(test)]
use crate::services::workspace_index_store_generation_service::clear_workspace_index_store_generation;
use crate::services::workspace_index_store_generation_service::{
    acquire_workspace_index_reader, record_workspace_index_write, workspace_index_store_generation,
    WorkspaceIndexReaderLease,
};
use crate::services::workspace_index_writer_connection_pool_service::WorkspaceIndexWriterConnectionPool;

const WORKSPACE_INDEX_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const WORKSPACE_INDEX_READER_POOL_LIMIT: usize = 4;

#[derive(Debug)]
pub(crate) struct WorkspaceIndexConnectionManager {
    reader_limit: usize,
    readers: Mutex<HashMap<PathBuf, Vec<Connection>>>,
    writer_gates: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    writer_metrics: WorkspaceIndexConnectionMetrics,
    writer_connections: WorkspaceIndexWriterConnectionPool,
}

impl Default for WorkspaceIndexConnectionManager {
    fn default() -> Self {
        Self::new(WORKSPACE_INDEX_READER_POOL_LIMIT)
    }
}

impl WorkspaceIndexConnectionManager {
    pub(crate) fn new(reader_limit: usize) -> Self {
        Self {
            reader_limit,
            readers: Mutex::new(HashMap::new()),
            writer_gates: Mutex::new(HashMap::new()),
            writer_metrics: WorkspaceIndexConnectionMetrics::default(),
            writer_connections: WorkspaceIndexWriterConnectionPool::default(),
        }
    }

    pub(crate) fn with_writer<T>(
        &self,
        root_path: &str,
        operation: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let store_path = workspace_index_store_path(root_path);
        create_store_parent(&store_path)?;
        let gate = self.writer_gate(&store_path)?;
        self.mark_writer_queued(&store_path);
        let wait_started = Instant::now();
        let guard = match gate.lock() {
            Ok(guard) => guard,
            Err(_) => {
                self.mark_writer_lock_failed(&store_path);
                self.release_writer_gate(&store_path, &gate);
                return Err("Workspace index writer gate poisoned".to_string());
            }
        };
        let wait_duration = wait_started.elapsed();
        self.mark_writer_acquired(&store_path);
        let hold_started = Instant::now();
        let result = (|| {
            let mut connection = match self.writer_connections.take(&store_path)? {
                Some(connection) => connection,
                None => {
                    let connection =
                        Connection::open(&store_path).map_err(|error| error.to_string())?;
                    configure_writer(&connection)?;
                    connection
                }
            };
            let result = operation(&mut connection);
            record_workspace_index_write(&store_path);
            self.writer_connections.put(store_path.clone(), connection);
            result
        })();
        let hold_duration = hold_started.elapsed();
        drop(guard);
        self.record_writer_finished(&store_path, wait_duration, hold_duration, result.is_err());
        self.release_writer_gate(&store_path, &gate);
        result
    }

    pub(crate) fn with_immediate_transaction<T>(
        &self,
        root_path: &str,
        prepare: impl FnOnce(&Connection) -> Result<(), String>,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let store_path = workspace_index_store_path(root_path);
        create_store_parent(&store_path)?;
        let gate = self.writer_gate(&store_path)?;
        self.mark_writer_queued(&store_path);
        let wait_started = Instant::now();
        let guard = match gate.lock() {
            Ok(guard) => guard,
            Err(_) => {
                self.mark_writer_lock_failed(&store_path);
                self.release_writer_gate(&store_path, &gate);
                return Err("Workspace index writer gate poisoned".to_string());
            }
        };
        let local_wait = wait_started.elapsed();
        let setup_started = Instant::now();
        let setup = match self.writer_connections.take(&store_path)? {
            Some(connection) => Ok(connection),
            None => Connection::open(&store_path)
                .map_err(|error| error.to_string())
                .and_then(|connection| {
                    configure_writer(&connection)?;
                    Ok(connection)
                }),
        }
        .and_then(|connection| {
            prepare(&connection)?;
            Ok(connection)
        });
        let mut connection = match setup {
            Ok(connection) => connection,
            Err(error) => {
                self.mark_writer_lock_failed(&store_path);
                drop(guard);
                self.release_writer_gate(&store_path, &gate);
                return Err(error);
            }
        };
        let setup_duration = setup_started.elapsed();
        let transaction_wait_started = Instant::now();
        let transaction = match connection.transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(transaction) => transaction,
            Err(error) => {
                self.mark_writer_lock_failed(&store_path);
                drop(guard);
                self.release_writer_gate(&store_path, &gate);
                return Err(error.to_string());
            }
        };
        let wait_duration = local_wait.saturating_add(transaction_wait_started.elapsed());
        self.mark_writer_acquired(&store_path);
        let publication_started = Instant::now();
        let result = operation(&transaction).and_then(|value| {
            transaction
                .commit()
                .map(|_| value)
                .map_err(|error| error.to_string())
        });
        if result.is_ok() {
            record_workspace_index_write(&store_path);
        }
        self.writer_connections.put(store_path.clone(), connection);
        let hold_duration = setup_duration.saturating_add(publication_started.elapsed());
        drop(guard);
        self.record_writer_finished(&store_path, wait_duration, hold_duration, result.is_err());
        self.release_writer_gate(&store_path, &gate);
        result
    }

    pub(crate) fn open_existing_reader(
        &self,
        root_path: &str,
    ) -> Result<Option<WorkspaceIndexReader<'_>>, String> {
        let store_path = workspace_index_store_path(root_path);
        let lease = acquire_workspace_index_reader(&store_path)?;
        if !store_path.exists() {
            return Ok(None);
        }
        let connection = match self.take_reader(&store_path)? {
            Some(connection) => connection,
            None => {
                let connection =
                    Connection::open(&store_path).map_err(|error| error.to_string())?;
                configure_reader(&connection)?;
                connection
            }
        };
        Ok(Some(WorkspaceIndexReader {
            connection: Some(connection),
            manager: self,
            store_path,
            lease,
        }))
    }

    pub(crate) fn commit_compaction_candidate(
        &self,
        root_path: &str,
        candidate: &WorkspaceIndexCompactionCandidate,
    ) -> Result<WorkspaceIndexCompactionCommit, String> {
        let store_path = workspace_index_store_path(root_path);
        let gate = self.writer_gate(&store_path)?;
        self.mark_writer_queued(&store_path);
        let wait_started = Instant::now();
        let guard = match gate.lock() {
            Ok(guard) => guard,
            Err(_) => {
                self.mark_writer_lock_failed(&store_path);
                self.release_writer_gate(&store_path, &gate);
                return Err("Workspace index writer gate poisoned".to_string());
            }
        };
        let wait_duration = wait_started.elapsed();
        self.mark_writer_acquired(&store_path);
        let hold_started = Instant::now();
        drop(self.writer_connections.take(&store_path)?);
        self.readers
            .lock()
            .map_err(|_| "Workspace index reader pool poisoned".to_string())?
            .remove(&store_path);
        let result = commit_workspace_index_compaction(&store_path, candidate);
        let hold_duration = hold_started.elapsed();
        drop(guard);
        self.record_writer_finished(&store_path, wait_duration, hold_duration, result.is_err());
        self.release_writer_gate(&store_path, &gate);
        result
    }

    pub(crate) fn quiesce_compaction_store(&self, root_path: &str) -> Result<bool, String> {
        let store_path = workspace_index_store_path(root_path);
        let gate = self.writer_gate(&store_path)?;
        let guard = gate
            .lock()
            .map_err(|_| "Workspace index writer gate poisoned".to_string())?;
        drop(self.writer_connections.take(&store_path)?);
        self.readers
            .lock()
            .map_err(|_| "Workspace index reader pool poisoned".to_string())?
            .remove(&store_path);
        let result = checkpoint_workspace_index_store(&store_path);
        drop(guard);
        self.release_writer_gate(&store_path, &gate);
        result
    }

    #[cfg(test)]
    pub(crate) fn clear(&self, root_path: &str) -> Result<(), String> {
        let store_path = workspace_index_store_path(root_path);
        self.readers
            .lock()
            .map_err(|_| "Workspace index reader pool poisoned".to_string())?
            .remove(&store_path);
        self.writer_gates
            .lock()
            .map_err(|_| "Workspace index writer gates poisoned".to_string())?
            .remove(&store_path);
        self.writer_metrics.clear(&store_path)?;
        self.writer_connections.discard(&store_path)?;
        clear_workspace_index_store_generation(&store_path);
        Ok(())
    }

    fn take_reader(&self, store_path: &Path) -> Result<Option<Connection>, String> {
        Ok(self
            .readers
            .lock()
            .map_err(|_| "Workspace index reader pool poisoned".to_string())?
            .get_mut(store_path)
            .and_then(Vec::pop))
    }

    fn return_reader(&self, store_path: PathBuf, generation: u64, connection: Connection) {
        if workspace_index_store_generation(&store_path).generation != generation {
            return;
        }
        let Ok(mut readers) = self.readers.lock() else {
            return;
        };
        let pooled_count = readers.values().map(Vec::len).sum::<usize>();
        if pooled_count >= self.reader_limit {
            return;
        }
        let pool = readers.entry(store_path).or_default();
        pool.push(connection);
    }

    fn writer_gate(&self, store_path: &Path) -> Result<Arc<Mutex<()>>, String> {
        Ok(self
            .writer_gates
            .lock()
            .map_err(|_| "Workspace index writer gates poisoned".to_string())?
            .entry(store_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn release_writer_gate(&self, store_path: &Path, gate: &Arc<Mutex<()>>) {
        if Arc::strong_count(gate) != 2 {
            return;
        }
        let Ok(mut gates) = self.writer_gates.lock() else {
            return;
        };
        let can_remove = gates.get(store_path).is_some_and(|registered| {
            Arc::ptr_eq(registered, gate) && Arc::strong_count(registered) == 2
        });
        if can_remove {
            gates.remove(store_path);
        }
    }

    fn mark_writer_queued(&self, store_path: &Path) {
        self.writer_metrics.mark_queued(store_path);
    }

    fn mark_writer_acquired(&self, store_path: &Path) {
        self.writer_metrics.mark_acquired(store_path);
    }

    fn mark_writer_lock_failed(&self, store_path: &Path) {
        self.writer_metrics.mark_lock_failed(store_path);
    }

    fn record_writer_finished(
        &self,
        store_path: &Path,
        wait_duration: Duration,
        hold_duration: Duration,
        failed: bool,
    ) {
        self.writer_metrics
            .record_finished(store_path, wait_duration, hold_duration, failed);
    }

    pub(crate) fn writer_metrics(&self, root_path: &str) -> WorkspaceIndexWriterMetrics {
        let store_path = workspace_index_store_path(root_path);
        self.writer_metrics.snapshot(&store_path)
    }

    #[cfg(test)]
    pub(crate) fn pooled_reader_count(&self, root_path: &str) -> usize {
        self.readers
            .lock()
            .ok()
            .and_then(|readers| {
                readers
                    .get(&workspace_index_store_path(root_path))
                    .map(Vec::len)
            })
            .unwrap_or_default()
    }
}

pub(crate) struct WorkspaceIndexReader<'a> {
    connection: Option<Connection>,
    manager: &'a WorkspaceIndexConnectionManager,
    store_path: PathBuf,
    lease: WorkspaceIndexReaderLease,
}

impl Deref for WorkspaceIndexReader<'_> {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.connection
            .as_ref()
            .expect("workspace index reader must own a connection")
    }
}

impl Drop for WorkspaceIndexReader<'_> {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.take() {
            self.manager.return_reader(
                self.store_path.clone(),
                self.lease.generation(),
                connection,
            );
        }
    }
}

pub(crate) fn with_workspace_index_writer<T>(
    root_path: &str,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    global_connection_manager().with_writer(root_path, operation)
}

pub(crate) fn with_workspace_index_transaction<T>(
    root_path: &str,
    prepare: impl FnOnce(&Connection) -> Result<(), String>,
    operation: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
) -> Result<T, String> {
    global_connection_manager().with_immediate_transaction(root_path, prepare, operation)
}

pub(crate) fn open_existing_workspace_index_reader(
    root_path: &str,
) -> Result<Option<WorkspaceIndexReader<'static>>, String> {
    global_connection_manager().open_existing_reader(root_path)
}

pub(crate) fn require_existing_workspace_index_reader(
    root_path: &str,
) -> Result<WorkspaceIndexReader<'static>, String> {
    open_existing_workspace_index_reader(root_path)?.ok_or_else(|| {
        format!(
            "Workspace index does not exist: {}",
            workspace_index_store_path(root_path).display()
        )
    })
}

pub(crate) fn workspace_index_writer_metrics(root_path: &str) -> WorkspaceIndexWriterMetrics {
    global_connection_manager().writer_metrics(root_path)
}

pub(crate) fn quiesce_workspace_index_store_for_compaction(
    root_path: &str,
) -> Result<bool, String> {
    global_connection_manager().quiesce_compaction_store(root_path)
}

pub(crate) fn commit_workspace_index_compaction_candidate(
    root_path: &str,
    candidate: &WorkspaceIndexCompactionCandidate,
) -> Result<WorkspaceIndexCompactionCommit, String> {
    global_connection_manager().commit_compaction_candidate(root_path, candidate)
}

pub(crate) fn workspace_index_store_path(root_path: &str) -> PathBuf {
    sqlite_catalog_cache_path(root_path)
}

fn global_connection_manager() -> &'static WorkspaceIndexConnectionManager {
    static MANAGER: OnceLock<WorkspaceIndexConnectionManager> = OnceLock::new();
    MANAGER.get_or_init(|| WorkspaceIndexConnectionManager::new(global_reader_pool_limit()))
}

#[cfg(not(test))]
fn global_reader_pool_limit() -> usize {
    WORKSPACE_INDEX_READER_POOL_LIMIT
}

#[cfg(test)]
fn global_reader_pool_limit() -> usize {
    0
}

fn create_store_parent(store_path: &Path) -> Result<(), String> {
    let Some(parent) = store_path.parent() else {
        return Err(format!(
            "Workspace SQLite index path has no parent: {}",
            store_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())
}

fn configure_writer(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(WORKSPACE_INDEX_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    let journal_mode = connection
        .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        connection
            .pragma_update(None, "journal_mode", "wal")
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute_batch("pragma synchronous = normal;")
        .map_err(|error| error.to_string())
}

fn configure_reader(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(WORKSPACE_INDEX_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "pragma synchronous = normal;
             pragma query_only = on;",
        )
        .map_err(|error| error.to_string())
}
