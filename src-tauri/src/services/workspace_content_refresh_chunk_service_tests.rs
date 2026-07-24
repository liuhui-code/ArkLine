use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_content_refresh_chunk_service::run_workspace_content_refresh_chunk;
use crate::services::workspace_content_refresh_service::{
    existing_content_paths, prepare_workspace_content_refresh_with_limits,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

#[test]
fn content_chunk_atomically_publishes_lines_and_both_search_indexes() {
    let root = unique_temp_dir("content-refresh-chunk-publish");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "const alpha = 1;\nconst beta = 2;\n").unwrap();
    let (root_path, source_path) = prepare_catalog(&root, &source);

    let summary =
        run_workspace_content_refresh_chunk(&root_path, &[source_path], &[], 100).unwrap();

    assert_eq!(summary.indexed_file_count, 1);
    assert_eq!(summary.indexed_line_count, 2);
    assert_eq!(summary.unreadable_file_count, 0);
    assert_eq!(
        summary
            .publication_profile
            .stages
            .iter()
            .map(|stage| stage.name.as_str())
            .collect::<Vec<_>>(),
        [
            "contentDelete",
            "contentInsert",
            "contentState",
            "contentGeneration",
        ]
    );
    let connection = open_index(&root);
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_trigram_fts",
    ] {
        let count: i64 = connection
            .query_row(&format!("select count(*) from {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2, "{table} should publish the same line set");
    }
    let generation: i64 = connection
        .query_row(
            "select indexed_generation from workspace_content_files",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(generation, 100);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_chunk_replay_is_idempotent_and_older_generation_is_rejected() {
    let root = unique_temp_dir("content-refresh-chunk-generation");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "const firstGeneration = 1;\n").unwrap();
    let (root_path, source_path) = prepare_catalog(&root, &source);

    run_workspace_content_refresh_chunk(&root_path, std::slice::from_ref(&source_path), &[], 100)
        .unwrap();
    run_workspace_content_refresh_chunk(&root_path, std::slice::from_ref(&source_path), &[], 100)
        .unwrap();
    let connection = open_index(&root);
    let replay_count: i64 = connection
        .query_row("select count(*) from workspace_content_lines", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(replay_count, 1);
    drop(connection);

    fs::write(&source, "const newerGeneration = 2;\n").unwrap();
    run_workspace_content_refresh_chunk(&root_path, std::slice::from_ref(&source_path), &[], 101)
        .unwrap();
    let error =
        run_workspace_content_refresh_chunk(&root_path, &[source_path], &[], 100).unwrap_err();
    assert!(error.contains("Stale content refresh generation"));
    let connection = open_index(&root);
    let text: String = connection
        .query_row("select text from workspace_content_lines", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(text.contains("newerGeneration"));
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fresh_content_paths_skip_existing_fts_cleanup() {
    let root = unique_temp_dir("content-refresh-fresh-path");
    fs::create_dir_all(&root).unwrap();
    let existing = root.join("Existing.ets");
    let fresh = root.join("Fresh.ets");
    fs::write(&existing, "const existing = 1;\n").unwrap();
    fs::write(&fresh, "const fresh = 1;\n").unwrap();
    let (root_path, existing_path) = prepare_catalog(&root, &existing);
    let (_, fresh_path) = prepare_catalog(&root, &fresh);
    run_workspace_content_refresh_chunk(
        &root_path,
        std::slice::from_ref(&existing_path),
        &[],
        100,
    )
    .unwrap();
    let connection = open_index(&root);
    let existing_key = existing_path.replace('/', "\\");
    let fresh_key = fresh_path.replace('/', "\\");
    let candidates = vec![&existing_key, &fresh_key];

    let selected = existing_content_paths(
        &connection,
        &root_path.replace('/', "\\"),
        &candidates,
    )
    .unwrap();

    assert_eq!(selected, vec![existing_key.as_str()]);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_chunk_removal_deletes_all_search_and_readiness_rows() {
    let root = unique_temp_dir("content-refresh-chunk-remove");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Removed.ets");
    fs::write(&source, "const removedTarget = 1;\n").unwrap();
    let (root_path, source_path) = prepare_catalog(&root, &source);
    run_workspace_content_refresh_chunk(&root_path, std::slice::from_ref(&source_path), &[], 100)
        .unwrap();

    run_workspace_content_refresh_chunk(&root_path, &[], &[source_path], 101).unwrap();

    let connection = open_index(&root);
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_trigram_fts",
        "workspace_content_files",
    ] {
        let count: i64 = connection
            .query_row(&format!("select count(*) from {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table} should remove the deleted path");
    }
    drop(connection);
    fs::write(&source, "const staleResurrection = 1;\n").unwrap();
    let error = run_workspace_content_refresh_chunk(
        &root_path,
        &[source.to_string_lossy().to_string()],
        &[],
        100,
    )
    .unwrap_err();
    assert!(error.contains("Stale content refresh generation 100"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unreadable_content_replaces_old_rows_with_explicit_failed_state() {
    let root = unique_temp_dir("content-refresh-chunk-unreadable");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "const oldContent = 1;\n").unwrap();
    let (root_path, source_path) = prepare_catalog(&root, &source);
    run_workspace_content_refresh_chunk(&root_path, std::slice::from_ref(&source_path), &[], 100)
        .unwrap();
    fs::remove_file(&source).unwrap();

    let summary =
        run_workspace_content_refresh_chunk(&root_path, &[source_path], &[], 101).unwrap();

    assert_eq!(summary.unreadable_file_count, 1);
    let connection = open_index(&root);
    let line_count: i64 = connection
        .query_row("select count(*) from workspace_content_lines", [], |row| {
            row.get(0)
        })
        .unwrap();
    let status: String = connection
        .query_row("select status from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(line_count, 0);
    assert_eq!(status, "failed");
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_prepare_bounds_file_and_chunk_bytes_without_copying_lines() {
    let root = unique_temp_dir("content-refresh-byte-budget");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("First.ets");
    let second = root.join("Second.ets");
    let oversized = root.join("Oversized.ets");
    fs::write(&first, "123456").unwrap();
    fs::write(&second, "abcdef").unwrap();
    fs::write(&oversized, "123456789").unwrap();
    let paths = [&first, &second, &oversized]
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    let prepared = prepare_workspace_content_refresh_with_limits(
        &root.to_string_lossy(),
        &paths,
        &[],
        1,
        8,
        8,
    );

    assert_eq!(prepared.files.len(), 1);
    assert_eq!(prepared.files[0].content, "123456");
    assert_eq!(prepared.files[0].line_count, 1);
    assert_eq!(prepared.files[0].source_bytes, 6);
    assert_eq!(prepared.source_bytes, 6);
    assert_eq!(prepared.failures.len(), 2);
    assert!(prepared.failures.iter().all(|item| item.resource_limited));
    assert!(prepared
        .failures
        .iter()
        .any(|item| item.error.contains("remaining 2 byte")));
    assert!(prepared
        .failures
        .iter()
        .any(|item| item.error.contains("8 byte content-index")));
    fs::remove_dir_all(root).unwrap();
}

fn prepare_catalog(root: &std::path::Path, source: &std::path::Path) -> (String, String) {
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    (root_path, source_path)
}

fn open_index(root: &std::path::Path) -> Connection {
    Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap()
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}
