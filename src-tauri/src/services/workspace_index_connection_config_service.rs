use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

const WORKSPACE_INDEX_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) fn create_store_parent(store_path: &Path) -> Result<(), String> {
    let Some(parent) = store_path.parent() else {
        return Err(format!(
            "Workspace SQLite index path has no parent: {}",
            store_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())
}

pub(super) fn configure_writer(connection: &Connection) -> Result<(), String> {
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

pub(super) fn configure_reader(connection: &Connection) -> Result<(), String> {
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
