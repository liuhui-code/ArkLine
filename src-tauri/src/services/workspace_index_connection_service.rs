use std::collections::{HashMap, VecDeque};
use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{Connection, Transaction, TransactionBehavior};

use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;

const WORKSPACE_INDEX_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const WORKSPACE_INDEX_READER_POOL_LIMIT: usize = 4;
const WORKSPACE_INDEX_WRITER_SAMPLE_LIMIT: usize = 128;

#[derive(Debug)]
pub(crate) struct WorkspaceIndexConnectionManager {
    reader_limit: usize,
    readers: Mutex<HashMap<PathBuf, Vec<Connection>>>,
    writer_gates: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    writer_metrics: Mutex<HashMap<PathBuf, WriterMetricState>>,
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
            writer_metrics: Mutex::new(HashMap::new()),
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
            let mut connection =
                Connection::open(&store_path).map_err(|error| error.to_string())?;
            configure_writer(&connection)?;
            operation(&mut connection)
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
        let setup = Connection::open(&store_path)
            .map_err(|error| error.to_string())
            .and_then(|connection| {
                configure_writer(&connection)?;
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
        if !store_path.exists() {
            return Ok(None);
        }
        let connection = self
            .take_reader(&store_path)?
            .map(Ok)
            .unwrap_or_else(|| Connection::open(&store_path).map_err(|error| error.to_string()))?;
        configure_reader(&connection)?;
        Ok(Some(WorkspaceIndexReader {
            connection: Some(connection),
            manager: self,
            store_path,
        }))
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
        self.writer_metrics
            .lock()
            .map_err(|_| "Workspace index writer metrics poisoned".to_string())?
            .remove(&store_path);
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

    fn return_reader(&self, store_path: PathBuf, connection: Connection) {
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
        self.update_writer_metrics(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_add(1);
        });
    }

    fn mark_writer_acquired(&self, store_path: &Path) {
        self.update_writer_metrics(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_sub(1);
            metrics.active_writer_count = metrics.active_writer_count.saturating_add(1);
        });
    }

    fn mark_writer_lock_failed(&self, store_path: &Path) {
        self.update_writer_metrics(store_path, |metrics| {
            metrics.queued_writer_count = metrics.queued_writer_count.saturating_sub(1);
            metrics.failure_count = metrics.failure_count.saturating_add(1);
        });
    }

    fn record_writer_finished(
        &self,
        store_path: &Path,
        wait_duration: Duration,
        hold_duration: Duration,
        failed: bool,
    ) {
        self.update_writer_metrics(store_path, |metrics| {
            metrics.active_writer_count = metrics.active_writer_count.saturating_sub(1);
            metrics.sample_count = metrics.sample_count.saturating_add(1);
            if failed {
                metrics.failure_count = metrics.failure_count.saturating_add(1);
            }
            push_bounded(&mut metrics.wait_samples_us, duration_us(wait_duration));
            push_bounded(&mut metrics.hold_samples_us, duration_us(hold_duration));
        });
    }

    fn update_writer_metrics(
        &self,
        store_path: &Path,
        update: impl FnOnce(&mut WriterMetricState),
    ) {
        let Ok(mut all_metrics) = self.writer_metrics.lock() else {
            return;
        };
        update(all_metrics.entry(store_path.to_path_buf()).or_default());
    }

    pub(crate) fn writer_metrics(&self, root_path: &str) -> WorkspaceIndexWriterMetrics {
        let store_path = workspace_index_store_path(root_path);
        self.writer_metrics
            .lock()
            .ok()
            .and_then(|metrics| metrics.get(&store_path).map(WriterMetricState::snapshot))
            .unwrap_or_default()
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

#[derive(Debug, Default)]
struct WriterMetricState {
    sample_count: u64,
    active_writer_count: usize,
    queued_writer_count: usize,
    failure_count: u64,
    wait_samples_us: VecDeque<u64>,
    hold_samples_us: VecDeque<u64>,
}

impl WriterMetricState {
    fn snapshot(&self) -> WorkspaceIndexWriterMetrics {
        let wait = percentiles(&self.wait_samples_us);
        let hold = percentiles(&self.hold_samples_us);
        WorkspaceIndexWriterMetrics {
            sample_count: self.sample_count,
            active_writer_count: self.active_writer_count,
            queued_writer_count: self.queued_writer_count,
            failure_count: self.failure_count,
            wait_p50_us: wait.p50,
            wait_p95_us: wait.p95,
            wait_p99_us: wait.p99,
            wait_max_us: wait.max,
            hold_p50_us: hold.p50,
            hold_p95_us: hold.p95,
            hold_p99_us: hold.p99,
            hold_max_us: hold.max,
            last_wait_us: self.wait_samples_us.back().copied().unwrap_or_default(),
            last_hold_us: self.hold_samples_us.back().copied().unwrap_or_default(),
        }
    }
}

#[derive(Default)]
struct Percentiles {
    p50: u64,
    p95: u64,
    p99: u64,
    max: u64,
}

fn percentiles(samples: &VecDeque<u64>) -> Percentiles {
    let mut sorted = samples.iter().copied().collect::<Vec<_>>();
    sorted.sort_unstable();
    Percentiles {
        p50: percentile(&sorted, 50),
        p95: percentile(&sorted, 95),
        p99: percentile(&sorted, 99),
        max: sorted.last().copied().unwrap_or_default(),
    }
}

fn percentile(sorted: &[u64], percentile: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let index = (sorted.len() * percentile).div_ceil(100).saturating_sub(1);
    sorted[index.min(sorted.len() - 1)]
}

fn push_bounded(samples: &mut VecDeque<u64>, value: u64) {
    if samples.len() == WORKSPACE_INDEX_WRITER_SAMPLE_LIMIT {
        samples.pop_front();
    }
    samples.push_back(value);
}

fn duration_us(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

pub(crate) struct WorkspaceIndexReader<'a> {
    connection: Option<Connection>,
    manager: &'a WorkspaceIndexConnectionManager,
    store_path: PathBuf,
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
            self.manager
                .return_reader(self.store_path.clone(), connection);
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

pub(crate) fn workspace_index_writer_metrics(root_path: &str) -> WorkspaceIndexWriterMetrics {
    global_connection_manager().writer_metrics(root_path)
}

pub(crate) fn workspace_index_store_path(root_path: &str) -> PathBuf {
    sqlite_catalog_cache_path(root_path)
}

pub(crate) fn optimize_workspace_index_store(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("pragma optimize;")
        .map_err(|error| error.to_string())
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
    connection
        .execute_batch(
            "pragma journal_mode = wal;
             pragma synchronous = normal;",
        )
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
