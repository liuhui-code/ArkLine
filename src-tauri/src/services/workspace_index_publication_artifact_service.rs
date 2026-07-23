use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::models::workspace_index_publication::WorkspaceIndexPublicationArtifactDescriptor;
use crate::services::workspace_content_refresh_service::PreparedWorkspaceContentRefresh;
use crate::services::workspace_discovery_runner_service::PreparedWorkspaceDiscoveryChunk;
use crate::services::workspace_index_maintenance_publication_service::WorkspaceIndexMaintenanceOperation;
use crate::services::workspace_sdk_index_service::PreparedWorkspaceSdkCatalogChunk;
use crate::services::workspace_stub_prepare_service::PreparedWorkspaceStubRefresh;

const PUBLICATION_ARTIFACT_BYTE_LIMIT: u64 = 40 * 1024 * 1024;
pub(crate) const PUBLICATION_ARTIFACT_RECOVERY_GRACE: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexPublicationRecoveryReport {
    pub(crate) scanned_count: u64,
    pub(crate) removed_count: u64,
    pub(crate) retained_count: u64,
    pub(crate) failure_count: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WorkspaceIndexPublicationArtifact {
    Discovery {
        root_path: String,
        prepared: PreparedWorkspaceDiscoveryChunk,
    },
    SdkCatalog {
        root_path: String,
        prepared: PreparedWorkspaceSdkCatalogChunk,
    },
    Content {
        root_path: String,
        prepared: PreparedWorkspaceContentRefresh,
    },
    Stub {
        root_path: String,
        prepared: PreparedWorkspaceStubRefresh,
    },
    Maintenance {
        root_path: String,
        operation: WorkspaceIndexMaintenanceOperation,
    },
}

pub(crate) fn write_workspace_publication_artifact(
    root_path: &str,
    artifact: &WorkspaceIndexPublicationArtifact,
) -> Result<WorkspaceIndexPublicationArtifactDescriptor, String> {
    let staging_dir = workspace_publication_staging_dir(root_path);
    fs::create_dir_all(&staging_dir).map_err(|error| error.to_string())?;
    let artifact_id = uuid::Uuid::new_v4();
    let temporary_path = staging_dir.join(format!("{artifact_id}.tmp"));
    let path = staging_dir.join(format!("{artifact_id}.json"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    let result = (|| {
        serde_json::to_writer(&mut writer, artifact).map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| error.to_string())?;
        let byte_count = fs::metadata(&temporary_path)
            .map_err(|error| error.to_string())?
            .len();
        if byte_count > PUBLICATION_ARTIFACT_BYTE_LIMIT {
            return Err("Workspace publication artifact exceeded the 40 MiB limit".to_string());
        }
        drop(writer);
        fs::rename(&temporary_path, &path).map_err(|error| error.to_string())?;
        Ok(WorkspaceIndexPublicationArtifactDescriptor {
            path: path.to_string_lossy().to_string(),
            byte_count,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

pub(crate) fn read_workspace_publication_artifact(
    root_path: &str,
    descriptor: &WorkspaceIndexPublicationArtifactDescriptor,
) -> Result<WorkspaceIndexPublicationArtifact, String> {
    let expected_dir = workspace_publication_staging_dir(root_path);
    let path = PathBuf::from(&descriptor.path);
    if path.parent() != Some(expected_dir.as_path())
        || path.extension().and_then(|extension| extension.to_str()) != Some("json")
    {
        return Err("Workspace publication artifact escaped its staging directory".to_string());
    }
    let byte_count = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if byte_count != descriptor.byte_count || byte_count > PUBLICATION_ARTIFACT_BYTE_LIMIT {
        return Err("Workspace publication artifact size did not match its descriptor".to_string());
    }
    serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| error.to_string())?,
    ))
    .map_err(|error| format!("Invalid workspace publication artifact: {error}"))
}

pub(crate) fn remove_workspace_publication_artifact(
    descriptor: &WorkspaceIndexPublicationArtifactDescriptor,
) {
    let _ = fs::remove_file(&descriptor.path);
}

pub(crate) fn recover_workspace_publication_staging(
    root_path: &str,
    grace_period: Duration,
) -> Result<WorkspaceIndexPublicationRecoveryReport, String> {
    let staging_dir = workspace_publication_staging_dir(root_path);
    let entries = match fs::read_dir(staging_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceIndexPublicationRecoveryReport::default());
        }
        Err(error) => return Err(error.to_string()),
    };
    let now = SystemTime::now();
    let mut report = WorkspaceIndexPublicationRecoveryReport::default();
    for entry in entries {
        let Ok(entry) = entry else {
            report.failure_count = report.failure_count.saturating_add(1);
            continue;
        };
        let path = entry.path();
        if !is_publication_staging_file(&path) {
            continue;
        }
        report.scanned_count = report.scanned_count.saturating_add(1);
        let modified = match entry.metadata().and_then(|metadata| metadata.modified()) {
            Ok(modified) => modified,
            Err(_) => {
                report.failure_count = report.failure_count.saturating_add(1);
                continue;
            }
        };
        let is_expired = now
            .duration_since(modified)
            .is_ok_and(|age| age >= grace_period);
        if !is_expired {
            report.retained_count = report.retained_count.saturating_add(1);
            continue;
        }
        match fs::remove_file(path) {
            Ok(()) => report.removed_count = report.removed_count.saturating_add(1),
            Err(_) => report.failure_count = report.failure_count.saturating_add(1),
        }
    }
    Ok(report)
}

fn is_publication_staging_file(path: &Path) -> bool {
    let extension = path.extension().and_then(|extension| extension.to_str());
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    matches!(extension, Some("json" | "tmp"))
        || extension == Some("sqlite") && name.starts_with("compaction-")
}

fn workspace_publication_staging_dir(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("staging")
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File, FileTimes};
    use std::time::{Duration, SystemTime};

    use super::{
        read_workspace_publication_artifact, recover_workspace_publication_staging,
        write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
    };
    use crate::services::workspace_content_refresh_service::PreparedWorkspaceContentRefresh;

    #[test]
    fn artifact_round_trip_is_confined_to_the_workspace_staging_directory() {
        let root = std::env::temp_dir().join(format!(
            "arkline-publication-artifact-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let artifact = WorkspaceIndexPublicationArtifact::Content {
            root_path: root_path.clone(),
            prepared: PreparedWorkspaceContentRefresh {
                indexed_generation: 12,
                refreshed_paths: vec!["Entry.ets".to_string()],
                removed_paths: Vec::new(),
                files: Vec::new(),
                failures: Vec::new(),
                source_bytes: 0,
            },
        };

        let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
        let restored = read_workspace_publication_artifact(&root_path, &descriptor).unwrap();

        assert_eq!(restored, artifact);
        assert!(descriptor.path.ends_with(".json"));
        assert!(!fs::read_dir(root.join(".arkline/index/staging"))
            .unwrap()
            .flatten()
            .any(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("tmp")));
        let mut escaped = descriptor;
        escaped.path = root.join("outside.json").to_string_lossy().to_string();
        assert!(read_workspace_publication_artifact(&root_path, &escaped)
            .unwrap_err()
            .contains("staging directory"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_removes_only_expired_publication_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "arkline-publication-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        let staging = root.join(".arkline").join("index").join("staging");
        fs::create_dir_all(&staging).unwrap();
        let expired_json = staging.join("expired.json");
        let expired_tmp = staging.join("expired.tmp");
        let expired_compaction = staging.join("compaction-expired.sqlite");
        let fresh_json = staging.join("fresh.json");
        let unrelated = staging.join("keep.txt");
        for path in [
            &expired_json,
            &expired_tmp,
            &expired_compaction,
            &fresh_json,
            &unrelated,
        ] {
            fs::write(path, "{}").unwrap();
        }
        let now = SystemTime::now();
        let expired_at = now.checked_sub(Duration::from_secs(600)).unwrap();
        let times = FileTimes::new().set_modified(expired_at);
        File::options()
            .write(true)
            .open(&expired_json)
            .unwrap()
            .set_times(times)
            .unwrap();
        File::options()
            .write(true)
            .open(&expired_compaction)
            .unwrap()
            .set_times(times)
            .unwrap();
        File::options()
            .write(true)
            .open(&expired_tmp)
            .unwrap()
            .set_times(times)
            .unwrap();

        let report = recover_workspace_publication_staging(
            &root.to_string_lossy(),
            Duration::from_secs(300),
        )
        .unwrap();

        assert_eq!(report.scanned_count, 4);
        assert_eq!(report.removed_count, 3);
        assert_eq!(report.retained_count, 1);
        assert!(!expired_json.exists());
        assert!(!expired_tmp.exists());
        assert!(!expired_compaction.exists());
        assert!(fresh_json.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
