use std::fs;
use std::path::Path;

use crate::models::device_log_query::{
    DeviceLogRetentionApplyResult, DeviceLogRetentionCandidate, DeviceLogRetentionPlan,
};
use crate::services::device_log_metadata_service::DeviceLogMetadataStore;

pub fn plan_device_log_storage_retention(
    root: &Path,
    target_bytes: u64,
) -> Result<DeviceLogRetentionPlan, String> {
    if !root.exists() {
        return Ok(DeviceLogRetentionPlan {
            current_bytes: 0,
            target_bytes,
            remove_file_count: 0,
            remove_bytes: 0,
            candidates: Vec::new(),
        });
    }

    let mut segments = collect_segment_retention_files(root)?;
    segments.sort_by_key(|segment| (segment.modified_ms, segment.file_name.clone()));
    let current_bytes = segments
        .iter()
        .fold(0_u64, |total, segment| total.saturating_add(segment.bytes));
    let mut remaining_bytes = current_bytes;
    let mut candidates = Vec::new();

    for segment in segments {
        if remaining_bytes <= target_bytes {
            break;
        }
        remaining_bytes = remaining_bytes.saturating_sub(segment.bytes);
        candidates.push(DeviceLogRetentionCandidate {
            file_name: segment.file_name,
            bytes: segment.bytes,
        });
    }
    let remove_bytes = candidates.iter().fold(0_u64, |total, candidate| {
        total.saturating_add(candidate.bytes)
    });

    Ok(DeviceLogRetentionPlan {
        current_bytes,
        target_bytes,
        remove_file_count: candidates.len(),
        remove_bytes,
        candidates,
    })
}

pub fn apply_device_log_storage_retention(
    root: &Path,
    target_bytes: u64,
) -> Result<DeviceLogRetentionApplyResult, String> {
    let plan = plan_device_log_storage_retention(root, target_bytes)?;
    let mut removed_file_count = 0_usize;
    let mut removed_bytes = 0_u64;
    let mut removed_segments = Vec::new();

    for candidate in plan.candidates {
        let path = root.join(&candidate.file_name);
        if !is_log_segment_file(&path) || !path.exists() {
            continue;
        }
        let bytes = fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        fs::remove_file(&path).map_err(|error| error.to_string())?;
        removed_file_count += 1;
        removed_bytes = removed_bytes.saturating_add(bytes);
        removed_segments.push(candidate.file_name);
    }

    if !removed_segments.is_empty() {
        DeviceLogMetadataStore::open(root)?.delete_batches_for_segment_files(&removed_segments)?;
    }

    Ok(DeviceLogRetentionApplyResult {
        removed_file_count,
        removed_bytes,
    })
}

fn collect_segment_retention_files(root: &Path) -> Result<Vec<RetentionSegmentFile>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !is_log_segment_file(&path) {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            continue;
        }
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let file_name = path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or_default()
            .to_string();
        files.push(RetentionSegmentFile {
            file_name,
            bytes: metadata.len(),
            modified_ms,
        });
    }
    Ok(files)
}

fn is_log_segment_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "logseg")
}

struct RetentionSegmentFile {
    file_name: String,
    bytes: u64,
    modified_ms: u64,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::services::device_log_metadata_service::{
        DeviceLogMetadataBatch, DeviceLogMetadataStore,
    };
    use crate::services::device_log_storage_health_service::inspect_device_log_storage;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn retention_plan_selects_oldest_segments_without_deleting_files() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        fs::write(temp.join("stream-older.logseg"), vec![b'p'; 40]).expect("older");
        thread::sleep(Duration::from_millis(5));
        fs::write(temp.join("stream-old.logseg"), vec![b'o'; 50]).expect("old");
        thread::sleep(Duration::from_millis(5));
        fs::write(temp.join("stream-new.logseg"), vec![b'n'; 60]).expect("new");

        let plan = plan_device_log_storage_retention(&temp, 100).expect("plan");

        assert_eq!(plan.current_bytes, 150);
        assert_eq!(plan.target_bytes, 100);
        assert_eq!(plan.remove_file_count, 2);
        assert_eq!(plan.remove_bytes, 90);
        assert_eq!(plan.candidates[0].file_name, "stream-older.logseg");
        assert_eq!(plan.candidates[1].file_name, "stream-old.logseg");
        assert!(temp.join("stream-older.logseg").exists());
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn apply_retention_removes_planned_segments_only() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        fs::write(temp.join("stream-older.logseg"), vec![b'p'; 40]).expect("older");
        thread::sleep(Duration::from_millis(5));
        fs::write(temp.join("stream-old.logseg"), vec![b'o'; 50]).expect("old");
        thread::sleep(Duration::from_millis(5));
        fs::write(temp.join("stream-new.logseg"), vec![b'n'; 60]).expect("new");
        fs::write(temp.join("unrelated.txt"), "keep").expect("unrelated");

        let result = apply_device_log_storage_retention(&temp, 100).expect("apply");

        assert_eq!(result.removed_file_count, 2);
        assert_eq!(result.removed_bytes, 90);
        assert!(!temp.join("stream-older.logseg").exists());
        assert!(!temp.join("stream-old.logseg").exists());
        assert!(temp.join("stream-new.logseg").exists());
        assert!(temp.join("unrelated.txt").exists());
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn apply_retention_removes_deleted_segment_metadata() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        fs::write(temp.join("stream-old.logseg"), vec![b'o'; 50]).expect("old");
        thread::sleep(Duration::from_millis(5));
        fs::write(temp.join("stream-new.logseg"), vec![b'n'; 60]).expect("new");
        let metadata = DeviceLogMetadataStore::open(&temp).expect("metadata");
        insert_metadata(&metadata, "stream-old.logseg", 50);
        insert_metadata(&metadata, "stream-new.logseg", 60);

        apply_device_log_storage_retention(&temp, 60).expect("apply");
        let health = inspect_device_log_storage(&temp).expect("health");

        assert_eq!(health.metadata_batch_count, 1);
        assert_eq!(health.metadata_line_count, 60);
        fs::remove_dir_all(temp).expect("cleanup");
    }

    fn insert_metadata(metadata: &DeviceLogMetadataStore, segment_file: &str, line_count: u64) {
        metadata
            .insert_batch(&DeviceLogMetadataBatch {
                stream_id: segment_file.trim_end_matches(".logseg").to_string(),
                device_id: "device-1".to_string(),
                first_seq: 1,
                received_at_ms: 10_000,
                line_count,
                segment_file: segment_file.to_string(),
                segment_offset: 0,
                segment_bytes: line_count,
                levels: vec![],
            })
            .expect("insert");
    }

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "arkline-device-log-retention-{}-{nanos}-{counter}",
            std::process::id(),
        ))
    }
}
