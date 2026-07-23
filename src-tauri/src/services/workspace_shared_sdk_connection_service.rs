use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{Connection, Transaction, TransactionBehavior};

const SHARED_SDK_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SharedSdkStoreSnapshot {
    pub(crate) revision: u64,
    pub(crate) generation: u64,
    pub(crate) active_readers: usize,
}

#[derive(Default)]
struct SharedSdkConnectionManager {
    writer_gates: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    initialized: Mutex<HashSet<PathBuf>>,
    stores: Mutex<HashMap<PathBuf, SharedSdkStoreSnapshot>>,
}

impl SharedSdkConnectionManager {
    fn ensure(
        &self,
        store_path: &Path,
        prepare: impl FnOnce(&Connection) -> Result<(), String>,
    ) -> Result<(), String> {
        if store_path.is_file()
            && self
                .initialized
                .lock()
                .map_err(|_| "Shared SDK initialized-store registry poisoned".to_string())?
                .contains(store_path)
        {
            return Ok(());
        }
        let gate = self.writer_gate(store_path)?;
        let _guard = gate
            .lock()
            .map_err(|_| "Shared SDK writer gate is poisoned".to_string())?;
        create_store_parent(store_path)?;
        let connection = Connection::open(store_path).map_err(|error| error.to_string())?;
        configure_writer(&connection)?;
        prepare(&connection)?;
        self.initialized
            .lock()
            .map_err(|_| "Shared SDK initialized-store registry poisoned".to_string())?
            .insert(store_path.to_path_buf());
        self.record_write(store_path);
        Ok(())
    }

    fn with_transaction<T>(
        &self,
        store_path: &Path,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let gate = self.writer_gate(store_path)?;
        let _guard = gate
            .lock()
            .map_err(|_| "Shared SDK writer gate is poisoned".to_string())?;
        let mut connection = Connection::open(store_path).map_err(|error| error.to_string())?;
        configure_writer(&connection)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let result = operation(&transaction).and_then(|value| {
            transaction
                .commit()
                .map(|_| value)
                .map_err(|error| error.to_string())
        });
        if result.is_ok() {
            self.record_write(store_path);
        }
        result
    }

    fn with_reader<T>(
        &self,
        store_path: &Path,
        operation: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let lease = self.acquire_reader(store_path)?;
        let connection = Connection::open(store_path).map_err(|error| error.to_string())?;
        configure_reader(&connection)?;
        let result = operation(&connection);
        drop(lease);
        result
    }

    fn snapshot(&self, store_path: &Path) -> SharedSdkStoreSnapshot {
        self.stores
            .lock()
            .ok()
            .and_then(|stores| stores.get(store_path).copied())
            .unwrap_or_default()
    }

    fn writer_gate(&self, store_path: &Path) -> Result<Arc<Mutex<()>>, String> {
        Ok(self
            .writer_gates
            .lock()
            .map_err(|_| "Shared SDK writer-gate registry poisoned".to_string())?
            .entry(store_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn record_write(&self, store_path: &Path) {
        if let Ok(mut stores) = self.stores.lock() {
            let state = stores.entry(store_path.to_path_buf()).or_default();
            state.revision = state.revision.saturating_add(1);
        }
    }

    fn acquire_reader(&self, store_path: &Path) -> Result<SharedSdkReaderLease<'_>, String> {
        let mut stores = self
            .stores
            .lock()
            .map_err(|_| "Shared SDK store-state registry poisoned".to_string())?;
        let state = stores.entry(store_path.to_path_buf()).or_default();
        state.active_readers = state.active_readers.saturating_add(1);
        Ok(SharedSdkReaderLease {
            manager: self,
            store_path: store_path.to_path_buf(),
        })
    }

    #[cfg(test)]
    fn clear(&self, store_path: &Path) {
        if let Ok(mut initialized) = self.initialized.lock() {
            initialized.remove(store_path);
        }
        if let Ok(mut stores) = self.stores.lock() {
            stores.remove(store_path);
        }
        if let Ok(mut gates) = self.writer_gates.lock() {
            gates.remove(store_path);
        }
    }
}

struct SharedSdkReaderLease<'a> {
    manager: &'a SharedSdkConnectionManager,
    store_path: PathBuf,
}

impl Drop for SharedSdkReaderLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut stores) = self.manager.stores.lock() {
            if let Some(state) = stores.get_mut(&self.store_path) {
                state.active_readers = state.active_readers.saturating_sub(1);
            }
        }
    }
}

pub(crate) fn ensure_shared_sdk_store(
    store_path: &Path,
    prepare: impl FnOnce(&Connection) -> Result<(), String>,
) -> Result<(), String> {
    manager().ensure(store_path, prepare)
}

pub(crate) fn with_shared_sdk_transaction<T>(
    store_path: &Path,
    operation: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
) -> Result<T, String> {
    manager().with_transaction(store_path, operation)
}

pub(crate) fn with_shared_sdk_reader<T>(
    store_path: &Path,
    operation: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    manager().with_reader(store_path, operation)
}

pub(crate) fn shared_sdk_store_snapshot(store_path: &Path) -> SharedSdkStoreSnapshot {
    manager().snapshot(store_path)
}

#[cfg(test)]
pub(crate) fn clear_shared_sdk_store_state(store_path: &Path) {
    manager().clear(store_path);
}

fn manager() -> &'static SharedSdkConnectionManager {
    static MANAGER: OnceLock<SharedSdkConnectionManager> = OnceLock::new();
    MANAGER.get_or_init(SharedSdkConnectionManager::default)
}

fn create_store_parent(store_path: &Path) -> Result<(), String> {
    if let Some(parent) = store_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn configure_writer(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(SHARED_SDK_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())
}

fn configure_reader(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(SHARED_SDK_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "query_only", true)
        .map_err(|error| error.to_string())
}
