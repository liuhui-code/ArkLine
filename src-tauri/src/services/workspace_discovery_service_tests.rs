use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_discovery_service::{
    discover_workspace_chunk, WorkspaceDiscoveryCursor,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn discovery_reports_missing_root_explicitly() {
    let missing = unique_temp_dir("workspace-discovery-missing");

    let error = discover_workspace_chunk(&missing, None, 10).unwrap_err();

    assert!(error.contains("Workspace path does not exist"));
}

#[test]
fn discovery_honors_default_excludes_and_counts_them() {
    let root = unique_temp_dir("workspace-discovery-excludes");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::create_dir_all(root.join("node_modules")).unwrap();
    fs::write(root.join("entry").join("Index.ets"), "struct Index {}\n").unwrap();
    fs::write(
        root.join("node_modules").join("ignored.ets"),
        "struct Ignored {}\n",
    )
    .unwrap();

    let chunk = discover_workspace_chunk(&root, None, 10).unwrap();
    let paths = chunk
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<Vec<_>>();

    assert_eq!(paths.len(), 1);
    assert!(paths[0].ends_with("entry/Index.ets") || paths[0].ends_with("entry\\Index.ets"));
    assert_eq!(chunk.excluded_count, 1);
    assert!(!chunk.has_more);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_returns_bounded_chunk_with_cursor() {
    let root = unique_temp_dir("workspace-discovery-bounded");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(root.join("B.ets"), "struct B {}\n").unwrap();
    fs::write(
        root.join("entry").join("src").join("C.ets"),
        "struct C {}\n",
    )
    .unwrap();

    let chunk = discover_workspace_chunk(&root, None, 2).unwrap();

    assert_eq!(chunk.files.len(), 2);
    assert!(chunk.has_more);
    assert!(chunk.cursor.is_some());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_cursor_resumes_without_duplicate_files() {
    let root = unique_temp_dir("workspace-discovery-resume");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::write(root.join("A.ets"), "struct A {}\n").unwrap();
    fs::write(root.join("B.ets"), "struct B {}\n").unwrap();
    fs::write(root.join("entry").join("C.ets"), "struct C {}\n").unwrap();

    let first = discover_workspace_chunk(&root, None, 2).unwrap();
    let second = discover_workspace_chunk(&root, first.cursor.clone(), 10).unwrap();
    let all_paths = first
        .files
        .iter()
        .chain(second.files.iter())
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let unique_paths = all_paths.iter().cloned().collect::<HashSet<_>>();

    assert_eq!(all_paths.len(), 3);
    assert_eq!(unique_paths.len(), 3);
    assert!(!second.has_more);
    assert!(second.cursor.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discovery_accepts_explicit_cursor() {
    let root = unique_temp_dir("workspace-discovery-explicit-cursor");
    fs::create_dir_all(root.join("entry")).unwrap();
    fs::write(root.join("entry").join("Only.ets"), "struct Only {}\n").unwrap();
    let cursor = WorkspaceDiscoveryCursor {
        pending_directories: vec![root.join("entry").to_string_lossy().to_string()],
    };

    let chunk = discover_workspace_chunk(&root, Some(cursor), 10).unwrap();

    assert_eq!(chunk.files.len(), 1);
    assert!(
        chunk.files[0].path.ends_with("entry/Only.ets")
            || chunk.files[0].path.ends_with("entry\\Only.ets")
    );

    fs::remove_dir_all(root).unwrap();
}
