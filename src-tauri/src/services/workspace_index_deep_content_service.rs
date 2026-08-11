use crate::indexer_host::{
    IndexerContentPublicationMode, IndexerContentRefreshAttempt, IndexerHostRuntime,
};
use crate::indexer_sidecar::{IndexerTaskKey, INDEXER_CONTENT_REFRESH_PATH_LIMIT};
use crate::services::workspace_content_chunk_plan_service::take_refresh_chunk;
use crate::services::workspace_content_refresh_service::WORKSPACE_CONTENT_MAX_CHUNK_BYTES;
use crate::services::workspace_index_adaptive_chunk_service::AdaptiveRefreshBudget;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTask;

use super::{publication_priority, should_defer_background, LayerChunkOutcome};

pub(super) fn refresh_content_chunks<G: Fn() -> bool + Sync>(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    indexed_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
    mode: IndexerContentPublicationMode,
    ui_latency_sensitive_at_start: bool,
    is_ui_latency_sensitive: &G,
) -> LayerChunkOutcome {
    let Some(indexer) = indexer else {
        return LayerChunkOutcome::Unavailable;
    };
    if indexed_generation == 0 || changed_paths.is_empty() && removed_paths.is_empty() {
        return LayerChunkOutcome::Unavailable;
    }
    let mut budget = AdaptiveRefreshBudget::new_for_background_deep_refresh(
        INDEXER_CONTENT_REFRESH_PATH_LIMIT,
        WORKSPACE_CONTENT_MAX_CHUNK_BYTES,
        ui_latency_sensitive_at_start,
    );
    let mut changed_offset = 0usize;
    let mut removed_offset = 0usize;
    while let Some(chunk) = take_refresh_chunk(
        &task.root_path,
        changed_paths,
        removed_paths,
        changed_offset,
        removed_offset,
        budget.path_count(),
        budget.source_bytes(),
    ) {
        if should_defer_background(task, ui_latency_sensitive_at_start, is_ui_latency_sensitive) {
            return LayerChunkOutcome::Deferred;
        }
        let path_count = chunk.changed_paths.len() + chunk.removed_paths.len();
        let next_changed_offset = chunk.next_changed_offset;
        let next_removed_offset = chunk.next_removed_offset;
        let mut yielded_for_ui = false;
        match indexer.refresh_content_chunk_with_priority(
            IndexerTaskKey {
                root_path: task.root_path.clone(),
                kind: "content-refresh".to_string(),
                generation: task.generation,
                reason: task.reason.clone(),
            },
            indexed_generation,
            chunk.changed_paths,
            chunk.removed_paths,
            publication_priority(task.priority),
            mode,
            || {
                yielded_for_ui |= should_defer_background(
                    task,
                    ui_latency_sensitive_at_start,
                    is_ui_latency_sensitive,
                );
                token.is_cancelled() || yielded_for_ui
            },
        ) {
            IndexerContentRefreshAttempt::Applied(result) => budget.observe(
                result.publication_profile.total_duration_us,
                path_count,
                result.processed_source_bytes,
            ),
            IndexerContentRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerContentRefreshAttempt::Cancelled if yielded_for_ui && !token.is_cancelled() => {
                return LayerChunkOutcome::Deferred;
            }
            IndexerContentRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
        }
        changed_offset = next_changed_offset;
        removed_offset = next_removed_offset;
    }
    LayerChunkOutcome::Applied
}
