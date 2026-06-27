use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, remove_file_fingerprints, update_file_fingerprints,
    WorkspaceFileFingerprintStatus,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn classifies_changed_unchanged_and_deleted_files_from_persisted_fingerprints() {
    let root = unique_temp_dir("workspace-file-fingerprints");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let stable_file = source_dir.join("Stable.ets");
    let changed_file = source_dir.join("Changed.ets");
    let deleted_file = source_dir.join("Deleted.ets");
    fs::write(&stable_file, "struct Stable {}\n").unwrap();
    fs::write(&changed_file, "struct Changed { value: string }\n").unwrap();
    fs::write(&deleted_file, "struct Deleted {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let stable_path = stable_file.to_string_lossy().to_string();
    let changed_path = changed_file.to_string_lossy().to_string();
    let deleted_path = deleted_file.to_string_lossy().to_string();
    update_file_fingerprints(
        &root_path,
        &[
            stable_path.clone(),
            changed_path.clone(),
            deleted_path.clone(),
        ],
        7,
    )
    .unwrap();

    fs::write(&changed_file, "struct Changed { value: number }\n").unwrap();
    fs::remove_file(&deleted_file).unwrap();
    let changes = classify_file_fingerprints(
        &root_path,
        &[
            stable_path.clone(),
            changed_path.clone(),
            deleted_path.clone(),
        ],
    )
    .unwrap();

    assert_eq!(changes.len(), 3);
    assert_eq!(changes[0].path, stable_path);
    assert_eq!(changes[0].status, WorkspaceFileFingerprintStatus::Unchanged);
    assert_eq!(changes[1].path, changed_path);
    assert_eq!(changes[1].status, WorkspaceFileFingerprintStatus::Changed);
    assert_eq!(changes[2].path, deleted_path);
    assert_eq!(changes[2].status, WorkspaceFileFingerprintStatus::Deleted);

    remove_file_fingerprints(&root_path, &[deleted_file.to_string_lossy().to_string()]).unwrap();
    fs::remove_dir_all(root).unwrap();
}
