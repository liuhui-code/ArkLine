use std::fs;
use std::path::Path;

use crate::models::device_log_query::{DeviceLogStorageClearResult, DeviceLogStorageHealth};
use crate::services::device_log_metadata_service::{
    DeviceLogMetadataStore, DeviceLogMetadataSummary,
};

const STORAGE_WARNING_BYTES: u64 = 512 * 1024 * 1024;
const STORAGE_CRITICAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub fn inspect_device_log_storage(root: &Path) -> Result<DeviceLogStorageHealth, String> {
    if !root.exists() {
        return Ok(empty_health(root));
    }

    let segments = inspect_segment_files(root)?;
    let metadata_bytes = metadata_file_bytes(root)?;
    let metadata = DeviceLogMetadataStore::open(root)?.storage_summary()?;
    let total_bytes = segments.bytes.saturating_add(metadata_bytes);
    let pressure = classify_storage_pressure(total_bytes);

    Ok(DeviceLogStorageHealth {
        root_path: root.display().to_string(),
        total_bytes,
        segment_file_count: segments.count,
        segment_bytes: segments.bytes,
        metadata_bytes,
        metadata_batch_count: metadata.batch_count,
        metadata_line_count: metadata.line_count,
        oldest_received_at_ms: metadata.oldest_received_at_ms,
        newest_received_at_ms: metadata.newest_received_at_ms,
        pressure_state: pressure.state.to_string(),
        recommended_action: pressure.action.to_string(),
    })
}

pub fn clear_device_log_storage(root: &Path) -> Result<DeviceLogStorageClearResult, String> {
    if !root.exists() {
        return Ok(DeviceLogStorageClearResult {
            removed_file_count: 0,
            removed_bytes: 0,
        });
    }

    let mut removed_file_count = 0_usize;
    let mut removed_bytes = 0_u64;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !is_device_log_storage_file(&path) {
            continue;
        }
        let bytes = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        fs::remove_file(path).map_err(|error| error.to_string())?;
        removed_file_count += 1;
        removed_bytes = removed_bytes.saturating_add(bytes);
    }

    Ok(DeviceLogStorageClearResult {
        removed_file_count,
        removed_bytes,
    })
}

fn inspect_segment_files(root: &Path) -> Result<StorageFileSummary, String> {
    let mut summary = StorageFileSummary::default();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension == "logseg")
        {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_file() {
            summary.count += 1;
            summary.bytes = summary.bytes.saturating_add(metadata.len());
        }
    }
    Ok(summary)
}

fn metadata_file_bytes(root: &Path) -> Result<u64, String> {
    [
        "device-log.sqlite",
        "device-log.sqlite-wal",
        "device-log.sqlite-shm",
    ]
    .iter()
    .try_fold(0_u64, |total, file_name| {
        let path = root.join(file_name);
        match fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => Ok(total.saturating_add(metadata.len())),
            Ok(_) | Err(_) => Ok(total),
        }
    })
}

fn is_device_log_storage_file(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "logseg")
    {
        return true;
    }
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .is_some_and(|file_name| {
            matches!(
                file_name,
                "device-log.sqlite" | "device-log.sqlite-wal" | "device-log.sqlite-shm"
            )
        })
}

fn empty_health(root: &Path) -> DeviceLogStorageHealth {
    let metadata = DeviceLogMetadataSummary {
        batch_count: 0,
        line_count: 0,
        oldest_received_at_ms: None,
        newest_received_at_ms: None,
    };
    DeviceLogStorageHealth {
        root_path: root.display().to_string(),
        total_bytes: 0,
        segment_file_count: 0,
        segment_bytes: 0,
        metadata_bytes: 0,
        metadata_batch_count: metadata.batch_count,
        metadata_line_count: metadata.line_count,
        oldest_received_at_ms: metadata.oldest_received_at_ms,
        newest_received_at_ms: metadata.newest_received_at_ms,
        pressure_state: "healthy".to_string(),
        recommended_action: "none".to_string(),
    }
}

fn classify_storage_pressure(total_bytes: u64) -> StoragePressure {
    if total_bytes >= STORAGE_CRITICAL_BYTES {
        return StoragePressure {
            state: "critical",
            action: "clearOldLogs",
        };
    }
    if total_bytes >= STORAGE_WARNING_BYTES {
        return StoragePressure {
            state: "warning",
            action: "reviewRetention",
        };
    }
    StoragePressure {
        state: "healthy",
        action: "none",
    }
}

#[derive(Default)]
struct StorageFileSummary {
    count: usize,
    bytes: u64,
}

struct StoragePressure {
    state: &'static str,
    action: &'static str,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::services::device_log_metadata_service::{
        DeviceLogMetadataBatch, DeviceLogMetadataStore,
    };
    use crate::services::device_log_segment_service::DeviceLogSegmentWriter;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn reports_segment_and_metadata_storage_totals() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
        let receipt = writer
            .append_lines(&["one".to_string(), "two".to_string()])
            .expect("append");
        let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
        metadata
            .insert_batch(&DeviceLogMetadataBatch {
                stream_id: "stream-1".to_string(),
                device_id: "device-1".to_string(),
                first_seq: 1,
                received_at_ms: 10_000,
                line_count: receipt.line_count,
                segment_file: receipt.segment_file,
                segment_offset: receipt.offset,
                segment_bytes: receipt.bytes,
                levels: vec!["info".to_string()],
            })
            .expect("insert");

        let health = inspect_device_log_storage(&temp).expect("health");

        assert_eq!(health.segment_file_count, 1);
        assert_eq!(health.segment_bytes, receipt.bytes);
        assert_eq!(health.metadata_batch_count, 1);
        assert_eq!(health.metadata_line_count, 2);
        assert!(health.total_bytes >= health.segment_bytes);
        assert_eq!(health.pressure_state, "healthy");
        assert_eq!(health.recommended_action, "none");
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn reports_empty_storage_for_missing_root() {
        let temp = unique_temp_dir();

        let health = inspect_device_log_storage(&temp).expect("health");

        assert_eq!(health.segment_file_count, 0);
        assert_eq!(health.segment_bytes, 0);
        assert_eq!(health.metadata_batch_count, 0);
        assert_eq!(health.metadata_line_count, 0);
        assert_eq!(health.total_bytes, 0);
        assert_eq!(health.pressure_state, "healthy");
        assert_eq!(health.recommended_action, "none");
    }

    #[test]
    fn reports_critical_pressure_for_large_log_storage() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let oversized_segment = temp.join("stream-1.logseg");
        fs::File::create(&oversized_segment)
            .expect("segment")
            .set_len(3 * 1024 * 1024 * 1024)
            .expect("sparse segment");

        let health = inspect_device_log_storage(&temp).expect("health");

        assert_eq!(health.segment_file_count, 1);
        assert_eq!(health.pressure_state, "critical");
        assert_eq!(health.recommended_action, "clearOldLogs");
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn clears_persisted_log_storage_files() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        fs::write(temp.join("stream-1.logseg"), "old logs").expect("segment");
        fs::write(temp.join("device-log.sqlite"), "metadata").expect("metadata");
        fs::write(temp.join("unrelated.txt"), "keep").expect("unrelated");

        let result = clear_device_log_storage(&temp).expect("clear");

        assert_eq!(result.removed_file_count, 2);
        assert!(result.removed_bytes >= "old logsmetadata".len() as u64);
        assert!(!temp.join("stream-1.logseg").exists());
        assert!(!temp.join("device-log.sqlite").exists());
        assert!(temp.join("unrelated.txt").exists());
        fs::remove_dir_all(temp).expect("cleanup");
    }

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "arkline-device-log-storage-health-{}-{nanos}-{counter}",
            std::process::id(),
        ))
    }
}
