use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

#[derive(Debug, Default)]
pub(crate) struct WorkspaceIndexWriterConnectionPool {
    connections: Mutex<HashMap<PathBuf, Connection>>,
}

impl WorkspaceIndexWriterConnectionPool {
    pub(crate) fn take(&self, store_path: &Path) -> Result<Option<Connection>, String> {
        Ok(self
            .connections
            .lock()
            .map_err(|_| "Workspace index writer pool poisoned".to_string())?
            .remove(store_path))
    }

    pub(crate) fn put(&self, store_path: PathBuf, connection: Connection) {
        if let Ok(mut connections) = self.connections.lock() {
            connections.insert(store_path, connection);
        }
    }

    pub(crate) fn discard(&self, store_path: &Path) -> Result<(), String> {
        self.connections
            .lock()
            .map_err(|_| "Workspace index writer pool poisoned".to_string())?
            .remove(store_path);
        Ok(())
    }
}
