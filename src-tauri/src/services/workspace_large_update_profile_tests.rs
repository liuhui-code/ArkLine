use std::fs;
use std::time::Instant;

use crate::services::workspace_content_index_service::update_workspace_content;
use crate::services::workspace_file_fingerprint_service::update_file_fingerprints;
use crate::services::workspace_index_chunk_service::chunk_paths;
use crate::services::workspace_index_entity_persistence_service::{
    persist_metadata_row, replace_changed_files, replace_changed_symbols,
};
use crate::services::workspace_index_persistence_service::persist_incremental_index_state;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_large_fixture_service::create_large_workspace_fixture;
use crate::services::workspace_service::scan_workspace;
use crate::services::workspace_stub_index_service::profile_replace_changed_stub_rows;
use crate::services::workspace_symbol_index_service::update_workspace_symbols_with_delta;

#[test]
#[ignore = "Run explicitly to profile continuous large workspace update chunks"]
fn profiles_large_workspace_update_chunks() {
    let file_count = env_usize("ARKLINE_LARGE_FIXTURE_FILES", 10_000);
    let chunk_limit = env_usize("ARKLINE_PROFILE_CHUNKS", 12);
    let chunk_size = profile_chunk_size();
    let fixture = create_large_workspace_fixture("large-update-profile", file_count).unwrap();
    let root_path = fixture.root_path.clone();
    let snapshot = scan_workspace(root_path.as_ref()).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let state = runtime
        .index_workspace_snapshot_for_open(&snapshot)
        .unwrap();
    let chunks = chunk_paths(state.file_paths.clone(), chunk_size);
    let mut durations = Vec::new();

    for paths in chunks.into_iter().take(chunk_limit) {
        let start = Instant::now();
        runtime
            .update_workspace_files(&root_path, &paths, &[])
            .unwrap();
        durations.push(start.elapsed());
    }

    eprintln!(
        "Large update chunk profile: files={file_count}, chunk_size={chunk_size}, chunks={}, durations={durations:?}",
        durations.len()
    );
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
#[ignore = "Run explicitly to profile continuous large workspace update stages"]
fn profiles_large_workspace_update_chunk_stages() {
    let file_count = env_usize("ARKLINE_LARGE_FIXTURE_FILES", 10_000);
    let chunk_limit = env_usize("ARKLINE_PROFILE_CHUNKS", 10);
    let chunk_size = profile_chunk_size();
    let fixture = create_large_workspace_fixture("large-update-stage-profile", file_count).unwrap();
    let root_path = fixture.root_path.clone();
    let snapshot = scan_workspace(root_path.as_ref()).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let mut state = runtime
        .index_workspace_snapshot_for_open(&snapshot)
        .unwrap();
    let chunks = chunk_paths(state.file_paths.clone(), chunk_size);
    let mut rows = Vec::new();

    for paths in chunks.into_iter().take(chunk_limit) {
        let symbol_start = Instant::now();
        let symbol_update = update_workspace_symbols_with_delta(&state.symbols, &paths, &[]);
        state.symbols = symbol_update.symbols;
        let symbol_duration = symbol_start.elapsed();

        let content_start = Instant::now();
        update_workspace_content(&root_path, &paths, &[]).unwrap();
        let content_duration = content_start.elapsed();

        let fingerprint_start = Instant::now();
        update_file_fingerprints(&root_path, &paths, 1).unwrap();
        let fingerprint_duration = fingerprint_start.elapsed();

        let persist_start = Instant::now();
        persist_incremental_index_state(
            &root_path,
            &state,
            &symbol_update.changed_symbols,
            &paths,
            &[],
        )
        .unwrap();
        let persist_duration = persist_start.elapsed();
        rows.push((
            symbol_duration,
            content_duration,
            fingerprint_duration,
            persist_duration,
        ));
    }

    eprintln!(
        "Large update stage profile: files={file_count}, chunk_size={chunk_size}, rows={rows:?}"
    );
    fs::remove_dir_all(root_path).unwrap();
}

#[test]
#[ignore = "Run explicitly to profile continuous large workspace persistence stages"]
fn profiles_large_workspace_persistence_chunk_stages() {
    let file_count = env_usize("ARKLINE_LARGE_FIXTURE_FILES", 10_000);
    let chunk_limit = env_usize("ARKLINE_PROFILE_CHUNKS", 10);
    let chunk_size = profile_chunk_size();
    let fixture =
        create_large_workspace_fixture("large-persistence-stage-profile", file_count).unwrap();
    let root_path = fixture.root_path.clone();
    let snapshot = scan_workspace(root_path.as_ref()).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let mut state = runtime
        .index_workspace_snapshot_for_open(&snapshot)
        .unwrap();
    let chunks = chunk_paths(state.file_paths.clone(), chunk_size);
    let sqlite_path = std::path::Path::new(&root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let mut rows = Vec::new();

    for paths in chunks.into_iter().take(chunk_limit) {
        let symbol_update = update_workspace_symbols_with_delta(&state.symbols, &paths, &[]);
        state.symbols = symbol_update.symbols;
        update_workspace_content(&root_path, &paths, &[]).unwrap();
        update_file_fingerprints(&root_path, &paths, 1).unwrap();

        let mut connection = rusqlite::Connection::open(&sqlite_path).unwrap();
        ensure_workspace_index_schema(&connection).unwrap();
        let root_key = root_path.replace('/', "\\");
        let transaction = connection.transaction().unwrap();

        let metadata_start = Instant::now();
        persist_metadata_row(&transaction, &root_key, &state).unwrap();
        let metadata_duration = metadata_start.elapsed();

        let files_start = Instant::now();
        replace_changed_files(&transaction, &root_key, &paths, &[]).unwrap();
        let files_duration = files_start.elapsed();

        let symbols_start = Instant::now();
        replace_changed_symbols(
            &transaction,
            &root_key,
            &symbol_update.changed_symbols,
            &paths,
            &[],
        )
        .unwrap();
        let symbols_duration = symbols_start.elapsed();

        let stub_profile = profile_replace_changed_stub_rows(
            &transaction,
            &root_key,
            &state.file_paths,
            &paths,
            &[],
            1,
        )
        .unwrap();
        transaction.commit().unwrap();
        rows.push((
            metadata_duration,
            files_duration,
            symbols_duration,
            stub_profile,
        ));
    }

    eprintln!(
        "Large persistence stage profile: files={file_count}, chunk_size={chunk_size}, rows={rows:?}"
    );
    fs::remove_dir_all(root_path).unwrap();
}

fn env_usize(name: &str, fallback: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(fallback)
}

fn profile_chunk_size() -> usize {
    env_usize(
        "ARKLINE_PROFILE_CHUNK_SIZE",
        crate::services::workspace_index_worker_service::WORKSPACE_INDEX_FULL_REFRESH_CHUNK_SIZE,
    )
}
