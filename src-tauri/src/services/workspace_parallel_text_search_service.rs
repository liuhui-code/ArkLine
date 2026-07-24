use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::models::workspace::{
    WorkspaceTextSearchCursor, WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_text_search_service::search_workspace_text_with_cancellation;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuilder};

const LARGE_WORKSPACE_FILE_COUNT: usize = 1_000;
const MAXIMUM_FIRST_RESULT_WORKERS: usize = 64;
const MINIMUM_FIRST_RESULT_WORKERS: usize = 64;
const WORKERS_PER_LOGICAL_CORE: usize = 4;
const CANCELLATION_POLL_INTERVAL: usize = 32;

static FIRST_RESULT_POOL: OnceLock<Result<ThreadPool, String>> = OnceLock::new();

pub(crate) fn search_workspace_files_responsive<F>(
    request: &WorkspaceTextSearchRequest,
    file_paths: &[String],
    is_cancelled: F,
) -> WorkspaceTextSearchResult
where
    F: FnMut() -> bool + Send,
{
    if request.cursor.is_some() || file_paths.len() < LARGE_WORKSPACE_FILE_COUNT {
        return search_workspace_text_with_cancellation(request, file_paths, is_cancelled);
    }
    search_first_result_parallel(request, file_paths, is_cancelled)
}

fn search_first_result_parallel<F>(
    request: &WorkspaceTextSearchRequest,
    file_paths: &[String],
    is_cancelled: F,
) -> WorkspaceTextSearchResult
where
    F: FnMut() -> bool + Send,
{
    let worker_count = file_paths.len().min(first_result_worker_count());
    let Some(pool) = first_result_pool(worker_count) else {
        let mut first_request = request.clone();
        first_request.limit = 1;
        return search_workspace_text_with_cancellation(&first_request, file_paths, is_cancelled);
    };
    let cancellation = Mutex::new(is_cancelled);
    let cancellation_observed = AtomicBool::new(false);
    let cancellation_poll_count = AtomicUsize::new(0);
    let search_finished = AtomicBool::new(false);
    let searched_files = AtomicUsize::new(0);
    let prefilter_skipped_files = AtomicUsize::new(0);
    let mut first_request = request.clone();
    first_request.limit = 1;
    first_request.cursor = None;
    let first = pool.install(|| {
        (0..worker_count).into_par_iter().find_map_any(|shard| {
            let (start, end) = shard_bounds(file_paths.len(), worker_count, shard);
            for path_index in centered_indices(start, end) {
                if search_finished.load(Ordering::Relaxed) {
                    return None;
                }
                let result = search_workspace_text_with_cancellation(
                    &first_request,
                    std::slice::from_ref(&file_paths[path_index]),
                    || {
                        if cancellation_observed.load(Ordering::Relaxed) {
                            return true;
                        }
                        let poll = cancellation_poll_count.fetch_add(1, Ordering::Relaxed);
                        if poll % CANCELLATION_POLL_INTERVAL != 0 {
                            return false;
                        }
                        let cancelled = cancellation
                            .lock()
                            .map(|mut is_cancelled| is_cancelled())
                            .unwrap_or(true);
                        cancellation_observed.fetch_or(cancelled, Ordering::Relaxed);
                        cancelled
                    },
                );
                searched_files.fetch_add(result.searched_files, Ordering::Relaxed);
                prefilter_skipped_files
                    .fetch_add(result.prefilter_skipped_files, Ordering::Relaxed);
                if !result.matches.is_empty() {
                    search_finished.store(true, Ordering::Relaxed);
                    return Some(result);
                }
            }
            None
        })
    });
    merge_first_result(
        request,
        first,
        searched_files.load(Ordering::Relaxed),
        prefilter_skipped_files.load(Ordering::Relaxed),
        cancellation_observed.load(Ordering::Relaxed),
    )
}

fn merge_first_result(
    request: &WorkspaceTextSearchRequest,
    first: Option<WorkspaceTextSearchResult>,
    searched_files: usize,
    prefilter_skipped_files: usize,
    cancellation_observed: bool,
) -> WorkspaceTextSearchResult {
    if let Some(mut result) = first {
        result.partial = true;
        result.limit_reached = true;
        result.next_cursor = Some(WorkspaceTextSearchCursor {
            path_index: 0,
            line_index: 0,
            source: Some("filesystem".to_string()),
        });
        result.searched_files = searched_files;
        result.prefilter_skipped_files = prefilter_skipped_files;
        return result;
    }

    let mut result = search_workspace_text_with_cancellation(request, &[], || false);
    result.partial = cancellation_observed;
    result.searched_files = searched_files;
    result.prefilter_skipped_files = prefilter_skipped_files;
    result
}

fn first_result_pool(requested_workers: usize) -> Option<&'static ThreadPool> {
    FIRST_RESULT_POOL
        .get_or_init(|| {
            ThreadPoolBuilder::new()
                .num_threads(requested_workers)
                .thread_name(|index| format!("arkline-text-search-{index}"))
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .ok()
}

fn first_result_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .saturating_mul(WORKERS_PER_LOGICAL_CORE)
        .clamp(MINIMUM_FIRST_RESULT_WORKERS, MAXIMUM_FIRST_RESULT_WORKERS)
}

fn shard_bounds(file_count: usize, worker_count: usize, shard: usize) -> (usize, usize) {
    (
        file_count * shard / worker_count,
        file_count * (shard + 1) / worker_count,
    )
}

fn centered_indices(start: usize, end: usize) -> impl Iterator<Item = usize> {
    let length = end.saturating_sub(start);
    let center = start + length / 2;
    (0..length).map(move |offset| {
        if offset == 0 {
            center
        } else if offset % 2 == 1 {
            center - (offset + 1) / 2
        } else {
            center + offset / 2
        }
    })
}
