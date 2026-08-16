use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

const DEFAULT_WRITER_CONNECTION_LIMIT: usize = 8;

#[derive(Debug)]
pub(crate) struct WorkspaceIndexWriterConnectionPool {
    capacity: usize,
    connections: Mutex<VecDeque<(PathBuf, Connection)>>,
}

impl Default for WorkspaceIndexWriterConnectionPool {
    fn default() -> Self {
        Self::new(DEFAULT_WRITER_CONNECTION_LIMIT)
    }
}

impl WorkspaceIndexWriterConnectionPool {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            connections: Mutex::new(VecDeque::with_capacity(capacity)),
        }
    }

    pub(crate) fn take(&self, store_path: &Path) -> Result<Option<Connection>, String> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| "Workspace index writer pool poisoned".to_string())?;
        let Some(index) = connections.iter().position(|(path, _)| path == store_path) else {
            return Ok(None);
        };
        Ok(connections.remove(index).map(|(_, connection)| connection))
    }

    pub(crate) fn put(&self, store_path: PathBuf, connection: Connection) {
        if self.capacity == 0 {
            return;
        }
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(index) = connections.iter().position(|(path, _)| path == &store_path) {
                connections.remove(index);
            }
            connections.push_back((store_path, connection));
            while connections.len() > self.capacity {
                connections.pop_front();
            }
        }
    }

    pub(crate) fn discard(&self, store_path: &Path) -> Result<(), String> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| "Workspace index writer pool poisoned".to_string())?;
        if let Some(index) = connections.iter().position(|(path, _)| path == store_path) {
            connections.remove(index);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.connections
            .lock()
            .map(|connections| connections.len())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspaceIndexWriterConnectionPool;
    use rusqlite::Connection;
    use std::path::PathBuf;

    #[test]
    fn evicts_the_least_recently_used_writer_connection() {
        let pool = WorkspaceIndexWriterConnectionPool::new(2);
        let first = PathBuf::from("first.sqlite");
        let second = PathBuf::from("second.sqlite");
        let third = PathBuf::from("third.sqlite");
        pool.put(first.clone(), Connection::open_in_memory().unwrap());
        pool.put(second.clone(), Connection::open_in_memory().unwrap());

        let first_connection = pool.take(&first).unwrap().unwrap();
        pool.put(first.clone(), first_connection);
        pool.put(third.clone(), Connection::open_in_memory().unwrap());

        assert!(pool.take(&second).unwrap().is_none());
        assert!(pool.take(&first).unwrap().is_some());
        assert!(pool.take(&third).unwrap().is_some());
    }
}
