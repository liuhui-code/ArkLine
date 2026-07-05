use std::fs;

use crate::services::workspace_discovery_service::{
    WorkspaceDiscoveredFile, WorkspaceDiscoveryCursor,
};
use crate::services::workspace_discovery_store_service::{
    replace_discovered_file_chunk, update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_full_refresh_service::refresh_workspace_index_in_chunks;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;
use crate::services::workspace_index_worker_service::WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE;

#[test]
fn refresh_workspace_index_in_chunks_yields_after_first_chunk_with_continuation() {
    let root = create_empty_workspace("chunked-full-refresh");
    let source_dir = root.join("entry/src/main/ets");
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    fs::write(source_dir.join("Seed.ets"), "struct Seed {}\n").unwrap();
    runtime.refresh_workspace_index(&root_path).unwrap();

    for index in 0..(WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE + 1) {
        fs::write(
            source_dir.join(format!("FullChunk{index}.ets")),
            format!("struct FullChunk{index} {{}}\n"),
        )
        .unwrap();
    }

    let outcome = refresh_workspace_index_in_chunks(
        &runtime,
        &root_path,
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE,
        &WorkspaceIndexCancellationToken::new(1),
    )
    .unwrap()
    .expect("refresh should finish");
    let continuation = outcome
        .continuation
        .expect("remaining full-refresh chunk should be returned");

    assert!(outcome.result.changed);
    assert_eq!(
        outcome.result.added_paths.len(),
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE
    );
    let progress = outcome.progress.unwrap();
    assert_eq!(progress.current_chunk, 1);
    assert_eq!(progress.total_chunks, 2);
    assert_eq!(continuation.remaining_chunk_count(), 1);
    assert_eq!(continuation.next_chunk_paths().unwrap().len(), 2);
    assert_eq!(
        runtime
            .get_index_state(&root_path)
            .unwrap()
            .file_paths
            .len(),
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE + 1
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refresh_workspace_index_in_chunks_uses_ready_discovery_files() {
    let root = create_empty_workspace("chunked-full-refresh-discovery");
    let source_dir = root.join("entry/src/main/ets");
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    fs::write(source_dir.join("Seed.ets"), "struct Seed {}\n").unwrap();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let discovered_path = source_dir.join("DiscoveredOnly.ets");
    let undiscovered_path = source_dir.join("NotDiscovered.ets");
    fs::write(&discovered_path, "struct DiscoveredOnly {}\n").unwrap();
    fs::write(&undiscovered_path, "struct NotDiscovered {}\n").unwrap();
    let discovered = WorkspaceDiscoveredFile {
        path: discovered_path.to_string_lossy().to_string(),
        size_bytes: 24,
        modified_ms: Some(123),
    };
    replace_discovered_file_chunk(&root_path, 2, &[discovered]).unwrap();
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 2,
        status: "ready".to_string(),
        discovered_count: 1,
        excluded_count: 0,
        cursor: None::<WorkspaceDiscoveryCursor>,
        error: None,
    })
    .unwrap();

    let outcome = refresh_workspace_index_in_chunks(
        &runtime,
        &root_path,
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE,
        &WorkspaceIndexCancellationToken::new(1),
    )
    .unwrap()
    .expect("refresh should finish");

    assert!(outcome.result.added_paths.contains(
        &discovered_path
            .to_string_lossy()
            .to_string()
            .replace('/', "\\")
    ));
    assert!(!outcome.result.added_paths.contains(
        &undiscovered_path
            .to_string_lossy()
            .to_string()
            .replace('/', "\\")
    ));

    fs::remove_dir_all(root).unwrap();
}
