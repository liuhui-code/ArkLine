use std::fs;

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
    assert_eq!(continuation.remaining_chunk_count(), 1);
    assert_eq!(continuation.next_chunk_paths().unwrap().len(), 2);
    assert_eq!(
        runtime
            .get_index_state(&root_path)
            .unwrap()
            .file_paths
            .len(),
        WORKSPACE_INDEX_CHANGED_PATH_CHUNK_SIZE
    );

    fs::remove_dir_all(root).unwrap();
}
