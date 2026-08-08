use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_content_refresh_service::index_workspace_content;
use crate::services::workspace_file_fingerprint_service::{
    classify_file_fingerprints, remove_file_fingerprints, update_file_catalog_fingerprints,
    update_file_fingerprints, WorkspaceFileFingerprintStatus,
};
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_file_index_policy_service::{
    classify_workspace_file, WorkspaceFileIndexClass, WorkspaceFileLayerPolicy,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn classifies_large_generated_and_binary_files_for_tiered_indexing() {
    let root = unique_temp_dir("workspace-file-index-policy");
    let generated_dir = root.join("entry").join("generated");
    fs::create_dir_all(&generated_dir).unwrap();
    let large = root.join("Large.ets");
    let generated = generated_dir.join("Bindings.ets");
    let binary = root.join("payload.dat");
    fs::write(&large, "123456789").unwrap();
    fs::write(&generated, "export class Bindings {}\n").unwrap();
    fs::write(&binary, b"text\0binary").unwrap();

    let large_policy = classify_workspace_file(&root, &large, 8).unwrap();
    let generated_policy = classify_workspace_file(&root, &generated, 1024).unwrap();
    let binary_policy = classify_workspace_file(&root, &binary, 1024).unwrap();

    assert_eq!(large_policy.class, WorkspaceFileIndexClass::LargeText);
    assert_eq!(large_policy.content, WorkspaceFileLayerPolicy::Skip);
    assert_eq!(generated_policy.class, WorkspaceFileIndexClass::Generated);
    assert_eq!(generated_policy.symbols, WorkspaceFileLayerPolicy::Skip);
    assert_eq!(binary_policy.class, WorkspaceFileIndexClass::Binary);
    assert!(binary_policy.reason.to_lowercase().contains("binary"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn policy_skipped_file_is_stable_after_deep_fingerprint_publication() {
    let root = unique_temp_dir("workspace-file-policy-stable");
    fs::create_dir_all(&root).unwrap();
    let binary = root.join("payload.bin");
    fs::write(&binary, b"\0payload").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let binary_path = binary.to_string_lossy().to_string();

    update_file_fingerprints(&root_path, std::slice::from_ref(&binary_path), 1).unwrap();
    let changes = classify_file_fingerprints(&root_path, &[binary_path]).unwrap();

    assert_eq!(changes[0].status, WorkspaceFileFingerprintStatus::Unchanged);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn catalog_observation_preserves_ready_layers_until_source_changes() {
    let root = unique_temp_dir("workspace-file-catalog-fingerprints");
    fs::create_dir_all(&root).unwrap();
    let source_file = root.join("Observed.ets");
    fs::write(&source_file, "export class Observed {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source_file.to_string_lossy().to_string();
    update_file_fingerprints(&root_path, std::slice::from_ref(&source_path), 1).unwrap();

    update_file_catalog_fingerprints(&root_path, std::slice::from_ref(&source_path), 2).unwrap();
    assert_eq!(
        classify_file_fingerprints(&root_path, std::slice::from_ref(&source_path)).unwrap()[0]
            .status,
        WorkspaceFileFingerprintStatus::Unchanged
    );

    fs::write(&source_file, "export class Observed { value = 1 }\n").unwrap();
    update_file_catalog_fingerprints(&root_path, std::slice::from_ref(&source_path), 3).unwrap();
    assert_eq!(
        classify_file_fingerprints(&root_path, std::slice::from_ref(&source_path)).unwrap()[0]
            .status,
        WorkspaceFileFingerprintStatus::Changed
    );

    fs::remove_dir_all(root).unwrap();
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

#[test]
fn missing_substring_publication_forces_crash_recovery_reindex() {
    let root = unique_temp_dir("workspace-file-fingerprint-substring-recovery");
    fs::create_dir_all(&root).unwrap();
    let source_file = root.join("Recover.ets");
    fs::write(&source_file, "export class Recoverable {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source_file.to_string_lossy().to_string();
    index_workspace_content(&root_path, std::slice::from_ref(&source_path)).unwrap();
    update_file_fingerprints(&root_path, std::slice::from_ref(&source_path), 1).unwrap();
    with_workspace_index_writer(&root_path, |connection| {
        connection
            .execute("delete from workspace_content_trigram_fts", [])
            .map_err(|error| error.to_string())?;
        connection
            .execute("delete from workspace_content_substring_files", [])
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .unwrap();

    let change = classify_file_fingerprints(&root_path, &[source_path]).unwrap();

    assert_eq!(change[0].status, WorkspaceFileFingerprintStatus::Changed);
    fs::remove_dir_all(root).unwrap();
}
