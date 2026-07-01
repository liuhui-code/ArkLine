use crate::services::workspace_index_chunk_service::{
    chunk_count, chunk_paths, chunk_progress, plan_refresh_continuation,
    WorkspaceIndexChunkProgress,
};

#[test]
fn chunks_paths_by_limit_without_dropping_order() {
    let chunks = chunk_paths(vec!["A.ets", "B.ets", "C.ets"], 2);

    assert_eq!(chunks, vec![vec!["A.ets", "B.ets"], vec!["C.ets"]]);
}

#[test]
fn chunk_limit_zero_falls_back_to_single_chunk() {
    let chunks = chunk_paths(vec!["A.ets", "B.ets"], 0);

    assert_eq!(chunks, vec![vec!["A.ets", "B.ets"]]);
}

#[test]
fn counts_chunks_for_empty_and_non_empty_inputs() {
    assert_eq!(chunk_count(0, 4), 0);
    assert_eq!(chunk_count(1, 4), 1);
    assert_eq!(chunk_count(8, 4), 2);
    assert_eq!(chunk_count(9, 4), 3);
}

#[test]
fn reports_one_based_chunk_progress() {
    let progress = chunk_progress(1, 3);

    assert_eq!(
        progress,
        WorkspaceIndexChunkProgress {
            current_chunk: 2,
            total_chunks: 3,
        }
    );
}

#[test]
fn refresh_continuation_pops_chunks_and_keeps_remaining_work() {
    let mut continuation =
        plan_refresh_continuation("/workspace", 9, vec!["A.ets", "B.ets", "C.ets"], 2);

    let first = continuation.pop_next_chunk().unwrap();

    assert_eq!(first.paths, vec!["A.ets", "B.ets"]);
    assert_eq!(first.progress.current_chunk, 1);
    assert_eq!(first.progress.total_chunks, 2);
    assert_eq!(continuation.remaining_chunk_count(), 1);
    assert!(!continuation.is_complete());

    let second = continuation.pop_next_chunk().unwrap();

    assert_eq!(second.paths, vec!["C.ets"]);
    assert_eq!(second.progress.current_chunk, 2);
    assert!(continuation.is_complete());
}
