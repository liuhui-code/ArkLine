use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection};

const DEVICE_LOG_SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceLogMetadataBatch {
    pub stream_id: String,
    pub device_id: String,
    pub first_seq: u64,
    pub received_at_ms: u64,
    pub line_count: u64,
    pub segment_file: String,
    pub segment_offset: u64,
    pub segment_bytes: u64,
    pub levels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceLogMetadataRow {
    pub stream_id: String,
    pub device_id: String,
    pub first_seq: u64,
    pub received_at_ms: u64,
    pub line_count: u64,
    pub segment_file: String,
    pub segment_offset: u64,
    pub segment_bytes: u64,
    pub levels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceLogMetadataSummary {
    pub batch_count: u64,
    pub line_count: u64,
    pub oldest_received_at_ms: Option<u64>,
    pub newest_received_at_ms: Option<u64>,
}

pub struct DeviceLogMetadataStore {
    connection: Connection,
}

impl DeviceLogMetadataStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let connection =
            Connection::open(root.join("device-log.sqlite")).map_err(|error| error.to_string())?;
        configure_connection(&connection)?;
        initialize_schema(&connection)?;
        Ok(Self { connection })
    }

    pub fn insert_batch(&self, batch: &DeviceLogMetadataBatch) -> Result<(), String> {
        let levels_json =
            serde_json::to_string(&batch.levels).map_err(|error| error.to_string())?;
        self.connection
            .execute(
                "insert into device_log_batches (
                    stream_id, device_id, first_seq, received_at_ms, line_count,
                    segment_file, segment_offset, segment_bytes, levels_json
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    batch.stream_id,
                    batch.device_id,
                    batch.first_seq as i64,
                    batch.received_at_ms as i64,
                    batch.line_count as i64,
                    batch.segment_file,
                    batch.segment_offset as i64,
                    batch.segment_bytes as i64,
                    levels_json
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(test)]
    pub fn query_range(
        &self,
        stream_id: &str,
        start_ms: u64,
        end_ms: u64,
        limit: usize,
    ) -> Result<Vec<DeviceLogMetadataRow>, String> {
        self.query_range_page(stream_id, start_ms, end_ms, limit, 0)
    }

    pub fn query_range_page(
        &self,
        stream_id: &str,
        start_ms: u64,
        end_ms: u64,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<DeviceLogMetadataRow>, String> {
        let mut statement = self
            .connection
            .prepare(
                "select stream_id, device_id, first_seq, received_at_ms, line_count,
                        segment_file, segment_offset, segment_bytes, levels_json
                   from device_log_batches
                  where stream_id = ?1 and received_at_ms between ?2 and ?3
                  order by received_at_ms desc, first_seq desc
                  limit ?4 offset ?5",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    stream_id,
                    start_ms as i64,
                    end_ms as i64,
                    limit as i64,
                    offset as i64
                ],
                row_from_sql,
            )
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn storage_summary(&self) -> Result<DeviceLogMetadataSummary, String> {
        self.connection
            .query_row(
                "select count(*), coalesce(sum(line_count), 0),
                        min(received_at_ms), max(received_at_ms)
                   from device_log_batches",
                [],
                |row| {
                    Ok(DeviceLogMetadataSummary {
                        batch_count: row.get::<_, i64>(0)? as u64,
                        line_count: row.get::<_, i64>(1)? as u64,
                        oldest_received_at_ms: optional_i64_to_u64(row.get(2)?),
                        newest_received_at_ms: optional_i64_to_u64(row.get(3)?),
                    })
                },
            )
            .map_err(|error| error.to_string())
    }

    pub fn delete_batches_for_segment_files(
        &self,
        segment_files: &[String],
    ) -> Result<usize, String> {
        let mut removed = 0_usize;
        for segment_file in segment_files {
            removed += self
                .connection
                .execute(
                    "delete from device_log_batches where segment_file = ?1",
                    params![segment_file],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(removed)
    }
}

fn configure_connection(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(DEVICE_LOG_SQLITE_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "pragma journal_mode = wal;
             pragma synchronous = normal;",
        )
        .map_err(|error| error.to_string())
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists device_log_batches (
                id integer primary key,
                stream_id text not null,
                device_id text not null,
                first_seq integer not null,
                received_at_ms integer not null,
                line_count integer not null,
                segment_file text not null,
                segment_offset integer not null,
                segment_bytes integer not null,
                levels_json text not null
            );
            create index if not exists idx_device_log_stream_time
                on device_log_batches(stream_id, received_at_ms);",
        )
        .map_err(|error| error.to_string())
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeviceLogMetadataRow> {
    let levels_json: String = row.get(8)?;
    let levels = serde_json::from_str::<Vec<String>>(&levels_json).unwrap_or_default();
    Ok(DeviceLogMetadataRow {
        stream_id: row.get(0)?,
        device_id: row.get(1)?,
        first_seq: row.get::<_, i64>(2)? as u64,
        received_at_ms: row.get::<_, i64>(3)? as u64,
        line_count: row.get::<_, i64>(4)? as u64,
        segment_file: row.get(5)?,
        segment_offset: row.get::<_, i64>(6)? as u64,
        segment_bytes: row.get::<_, i64>(7)? as u64,
        levels,
    })
}

fn optional_i64_to_u64(value: Option<i64>) -> Option<u64> {
    value.and_then(|number| u64::try_from(number).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn stores_line_offsets_and_queries_recent_range() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let store = DeviceLogMetadataStore::open(&temp).expect("store");

        store
            .insert_batch(&DeviceLogMetadataBatch {
                stream_id: "stream-1".to_string(),
                device_id: "device-1".to_string(),
                first_seq: 1,
                received_at_ms: 10_000,
                line_count: 2,
                segment_file: "stream-1.logseg".to_string(),
                segment_offset: 0,
                segment_bytes: 8,
                levels: vec!["info".to_string(), "error".to_string()],
            })
            .expect("insert");

        let rows = store
            .query_range("stream-1", 9_000, 11_000, 100)
            .expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].line_count, 2);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn configures_sqlite_for_continuous_log_writes() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let store = DeviceLogMetadataStore::open(&temp).expect("store");

        let journal_mode: String = store
            .connection
            .query_row("pragma journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        let busy_timeout_ms: i64 = store
            .connection
            .query_row("pragma busy_timeout", [], |row| row.get(0))
            .expect("busy timeout");
        let synchronous: i64 = store
            .connection
            .query_row("pragma synchronous", [], |row| row.get(0))
            .expect("synchronous");

        assert_eq!(journal_mode, "wal");
        assert!(busy_timeout_ms >= 5_000);
        assert_eq!(synchronous, 1);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn deletes_batches_for_retained_segment_files() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let store = DeviceLogMetadataStore::open(&temp).expect("store");
        for (stream_id, segment_file) in [("stream-1", "old.logseg"), ("stream-2", "new.logseg")] {
            store
                .insert_batch(&DeviceLogMetadataBatch {
                    stream_id: stream_id.to_string(),
                    device_id: "device-1".to_string(),
                    first_seq: 1,
                    received_at_ms: 10_000,
                    line_count: 2,
                    segment_file: segment_file.to_string(),
                    segment_offset: 0,
                    segment_bytes: 8,
                    levels: vec![],
                })
                .expect("insert");
        }

        let removed = store
            .delete_batches_for_segment_files(&["old.logseg".to_string()])
            .expect("delete");

        assert_eq!(removed, 1);
        assert_eq!(store.storage_summary().expect("summary").batch_count, 1);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "arkline-device-log-metadata-{}-{nanos}-{counter}",
            std::process::id(),
        ))
    }
}
