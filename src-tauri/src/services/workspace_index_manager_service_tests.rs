use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_file_fingerprint_service::classify_file_fingerprints;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn opens_workspace_index_through_the_manager_entry_point() {
    let root = unique_temp_dir("workspace-index-manager-open");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Home.ets"),
        "struct Home {\n  build() { Text(\"OpenThroughManager\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let results = manager.drain_index_tasks(&index_runtime).unwrap();
    let state = index_runtime.get_index_state(&root_path).unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].changed);
    assert_eq!(state.file_paths.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn coalesces_watcher_changes_before_refreshing_the_index() {
    let root = unique_temp_dir("workspace-index-manager-coalesce");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"BeforeManagerRefresh\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"AfterManagerRefresh\") }\n}\n",
    )
    .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path.clone()])
        .unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();

    let results = manager.drain_index_tasks(&index_runtime).unwrap();
    let matches = search_indexed_workspace_content(&WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "AfterManagerRefresh".to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 0,
    })
    .unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].changed);
    assert_eq!(matches.matches.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn skips_watcher_refresh_when_fingerprints_are_unchanged() {
    let root = unique_temp_dir("workspace-index-manager-unchanged");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Index.ets");
    fs::write(
        &source_file,
        "struct Index {\n  build() { Text(\"UnchangedFingerprint\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let changed_path = source_file.to_string_lossy().to_string();
    let index_runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    index_runtime.refresh_workspace_index(&root_path).unwrap();

    let fingerprint_changes =
        classify_file_fingerprints(&root_path, &[changed_path.clone()]).unwrap();
    manager
        .schedule_changed_paths(&root_path, &[changed_path])
        .unwrap();
    let results = manager.drain_index_tasks(&index_runtime).unwrap();

    assert!(fingerprint_changes
        .iter()
        .all(|change| change.status
            == crate::services::workspace_file_fingerprint_service::WorkspaceFileFingerprintStatus::Unchanged));
    assert!(results.is_empty());

    fs::remove_dir_all(root).unwrap();
}
