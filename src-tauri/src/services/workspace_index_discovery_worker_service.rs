use std::path::Path;

use crate::indexer_host::{IndexerDiscoveryAttempt, IndexerHostRuntime};
use crate::indexer_sidecar::IndexerTaskKey;
use crate::runtime_logging;
use crate::services::workspace_discovery_runner_service::run_workspace_discovery_chunk;
use crate::services::workspace_discovery_task_service::workspace_discovery_task_cursor;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_discovery_result_service::{
    discovery_task_result, discovery_task_result_from_counts,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTask;
use crate::services::workspace_index_task_status_service::{
    superseded_task_result_from_task, WorkspaceIndexTaskResult,
};

const WORKSPACE_DISCOVERY_CHUNK_SIZE: usize = 1024;

pub(crate) fn run_workspace_discovery_task(
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    started_at: u128,
    indexer: Option<&IndexerHostRuntime>,
) -> Result<WorkspaceIndexTaskResult, String> {
    if token.is_cancelled() {
        return Ok(superseded_task_result_from_task(task));
    }
    let cursor = workspace_discovery_task_cursor(task);
    runtime_logging::log_discovery_chunk_started(
        &task.root_path,
        task.generation,
        cursor
            .as_ref()
            .map(|value| value.pending_directories.len())
            .unwrap_or(1),
        WORKSPACE_DISCOVERY_CHUNK_SIZE,
    );
    if let Some(runtime) = indexer {
        match runtime.discover_workspace_chunk(
            IndexerTaskKey {
                root_path: task.root_path.clone(),
                kind: "discovery".to_string(),
                generation: task.generation,
                reason: task.reason.clone(),
            },
            cursor
                .as_ref()
                .map(|value| value.pending_directories.clone()),
            WORKSPACE_DISCOVERY_CHUNK_SIZE,
        ) {
            IndexerDiscoveryAttempt::Applied(result) => {
                runtime_logging::log_discovery_chunk_completed(
                    &task.root_path,
                    task.generation,
                    "sidecar",
                    result.chunk_file_count,
                    result.excluded_count,
                    result.has_more,
                );
                return Ok(discovery_task_result_from_counts(
                    task,
                    result.chunk_file_count,
                    result.excluded_count,
                    result.has_more,
                    started_at,
                ));
            }
            IndexerDiscoveryAttempt::Cancelled => {
                return Ok(superseded_task_result_from_task(task));
            }
            IndexerDiscoveryAttempt::Unavailable => {
                runtime_logging::log_discovery_fallback(
                    &task.root_path,
                    task.generation,
                    "indexer sidecar unavailable",
                );
            }
        }
        if runtime.requires_process_isolation() {
            runtime.record_local_fallback();
        }
    }
    let chunk = match run_workspace_discovery_chunk(
        Path::new(&task.root_path),
        cursor,
        WORKSPACE_DISCOVERY_CHUNK_SIZE,
        task.generation as i64,
    ) {
        Ok(chunk) => chunk,
        Err(error) => {
            runtime_logging::log_discovery_failed(
                &task.root_path,
                task.generation,
                "local",
                &error,
            );
            return Err(error);
        }
    };
    runtime_logging::log_discovery_chunk_completed(
        &task.root_path,
        task.generation,
        "local",
        chunk.files.len(),
        chunk.excluded_count,
        chunk.has_more,
    );
    Ok(discovery_task_result(task, &chunk, started_at))
}
