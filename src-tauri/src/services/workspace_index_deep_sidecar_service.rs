use crate::indexer_host::{
    IndexerContentRefreshAttempt, IndexerHostRuntime, IndexerStubRefreshAttempt,
};
use crate::indexer_sidecar::{
    IndexerTaskKey, INDEXER_CONTENT_REFRESH_PATH_LIMIT, INDEXER_STUB_REFRESH_PATH_LIMIT,
};
use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_content_chunk_plan_service::take_refresh_chunk;
use crate::services::workspace_content_refresh_service::update_workspace_content_at_generation;
use crate::services::workspace_content_refresh_service::WORKSPACE_CONTENT_MAX_CHUNK_BYTES;
use crate::services::workspace_index_adaptive_chunk_service::AdaptiveRefreshBudget;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_layer_generation_service::{
    latest_layer_generation, CONTENT_LAYER, STUB_LAYER,
};
use crate::services::workspace_index_persistence_service::persist_incremental_deep_index_state_with_priority;
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_stub_refresh_chunk_service::workspace_file_catalog_contains_paths;

pub(crate) enum WorkspaceDeepLayerUpdate {
    Applied(WorkspaceIndexState),
    Cancelled,
}

pub(crate) fn update_background_deep_layer(
    index_runtime: &WorkspaceIndexRuntime,
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<WorkspaceDeepLayerUpdate, String> {
    if token.is_cancelled() {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }
    let state = index_runtime.get_index_state(&task.root_path)?;
    let catalog_generation = state.indexed_at.unwrap_or_default() as u64;
    let content_generation = latest_layer_generation(&task.root_path, CONTENT_LAYER)?
        .unwrap_or_default()
        .max(catalog_generation);
    let stub_generation = latest_layer_generation(&task.root_path, STUB_LAYER)?
        .unwrap_or_default()
        .max(catalog_generation);

    let sidecar_ready = workspace_file_catalog_contains_paths(&task.root_path, changed_paths)?;
    let (content_outcome, stub_outcome) = if sidecar_ready && sidecar_priority(task.priority) {
        refresh_sidecar_layers(
            indexer,
            task,
            token,
            content_generation,
            stub_generation,
            changed_paths,
            removed_paths,
        )
    } else {
        (
            LayerChunkOutcome::Unavailable,
            LayerChunkOutcome::Unavailable,
        )
    };
    if matches!(content_outcome, LayerChunkOutcome::Cancelled)
        || matches!(stub_outcome, LayerChunkOutcome::Cancelled)
    {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }
    let content_applied_by_sidecar = matches!(content_outcome, LayerChunkOutcome::Applied);
    let stub_applied_by_sidecar = matches!(stub_outcome, LayerChunkOutcome::Applied);
    if content_applied_by_sidecar && stub_applied_by_sidecar {
        return Ok(WorkspaceDeepLayerUpdate::Applied(state));
    }
    if token.is_cancelled() {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }
    if !content_applied_by_sidecar {
        update_workspace_content_at_generation(
            &task.root_path,
            changed_paths,
            removed_paths,
            content_generation,
        )?;
    }
    if token.is_cancelled() {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }

    if !stub_applied_by_sidecar {
        let mut stub_state = state.clone();
        stub_state.indexed_at = Some(stub_generation as u128);
        persist_incremental_deep_index_state_with_priority(
            &task.root_path,
            &stub_state,
            changed_paths,
            removed_paths,
            task.priority,
        )?;
    }
    Ok(WorkspaceDeepLayerUpdate::Applied(state))
}

#[derive(Clone, Copy)]
enum LayerChunkOutcome {
    Applied,
    Unavailable,
    Cancelled,
}

fn refresh_sidecar_layers(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    content_generation: u64,
    stub_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
) -> (LayerChunkOutcome, LayerChunkOutcome) {
    let Some(indexer) = indexer else {
        return (
            LayerChunkOutcome::Unavailable,
            LayerChunkOutcome::Unavailable,
        );
    };
    if indexer.supports_parallel_deep_refresh() {
        return std::thread::scope(|scope| {
            let content = scope.spawn(|| {
                refresh_content_chunks(
                    Some(indexer),
                    task,
                    token,
                    content_generation,
                    changed_paths,
                    removed_paths,
                )
            });
            let stub = scope.spawn(|| {
                refresh_stub_chunks(
                    Some(indexer),
                    task,
                    token,
                    stub_generation,
                    changed_paths,
                    removed_paths,
                )
            });
            (
                content.join().unwrap_or(LayerChunkOutcome::Unavailable),
                stub.join().unwrap_or(LayerChunkOutcome::Unavailable),
            )
        });
    }
    let content = refresh_content_chunks(
        Some(indexer),
        task,
        token,
        content_generation,
        changed_paths,
        removed_paths,
    );
    let stub = if matches!(content, LayerChunkOutcome::Applied) {
        refresh_stub_chunks(
            Some(indexer),
            task,
            token,
            stub_generation,
            changed_paths,
            removed_paths,
        )
    } else {
        LayerChunkOutcome::Unavailable
    };
    (content, stub)
}

fn refresh_stub_chunks(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    indexed_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
) -> LayerChunkOutcome {
    let Some(indexer) = indexer else {
        return LayerChunkOutcome::Unavailable;
    };
    if indexed_generation == 0 || changed_paths.is_empty() && removed_paths.is_empty() {
        return LayerChunkOutcome::Unavailable;
    }
    let mut budget = AdaptiveRefreshBudget::new(
        INDEXER_STUB_REFRESH_PATH_LIMIT,
        WORKSPACE_CONTENT_MAX_CHUNK_BYTES,
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
        let path_count = chunk.changed_paths.len() + chunk.removed_paths.len();
        let source_bytes = chunk.changed_source_bytes;
        let next_changed_offset = chunk.next_changed_offset;
        let next_removed_offset = chunk.next_removed_offset;
        match indexer.refresh_stub_chunk_with_priority(
            IndexerTaskKey {
                root_path: task.root_path.clone(),
                kind: "stub-refresh".to_string(),
                generation: task.generation,
                reason: task.reason.clone(),
            },
            indexed_generation,
            chunk.changed_paths,
            chunk.removed_paths,
            publication_priority(task.priority),
            || token.is_cancelled(),
        ) {
            IndexerStubRefreshAttempt::Applied(result) => budget.observe(
                result.publication_profile.total_duration_us,
                path_count,
                source_bytes,
            ),
            IndexerStubRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerStubRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
        }
        changed_offset = next_changed_offset;
        removed_offset = next_removed_offset;
    }
    LayerChunkOutcome::Applied
}

fn refresh_content_chunks(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    indexed_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
) -> LayerChunkOutcome {
    let Some(indexer) = indexer else {
        return LayerChunkOutcome::Unavailable;
    };
    if indexed_generation == 0 || changed_paths.is_empty() && removed_paths.is_empty() {
        return LayerChunkOutcome::Unavailable;
    }
    let mut budget = AdaptiveRefreshBudget::new(
        INDEXER_CONTENT_REFRESH_PATH_LIMIT,
        WORKSPACE_CONTENT_MAX_CHUNK_BYTES,
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
        let path_count = chunk.changed_paths.len() + chunk.removed_paths.len();
        let next_changed_offset = chunk.next_changed_offset;
        let next_removed_offset = chunk.next_removed_offset;
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
            || token.is_cancelled(),
        ) {
            IndexerContentRefreshAttempt::Applied(result) => budget.observe(
                result.publication_profile.total_duration_us,
                path_count,
                result.processed_source_bytes,
            ),
            IndexerContentRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerContentRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
        }
        changed_offset = next_changed_offset;
        removed_offset = next_removed_offset;
    }
    LayerChunkOutcome::Applied
}

fn sidecar_priority(priority: WorkspaceIndexTaskPriority) -> bool {
    matches!(
        priority,
        WorkspaceIndexTaskPriority::Background | WorkspaceIndexTaskPriority::ChangedFiles
    )
}

fn publication_priority(priority: WorkspaceIndexTaskPriority) -> PublicationPriority {
    if matches!(priority, WorkspaceIndexTaskPriority::ChangedFiles) {
        PublicationPriority::Foreground
    } else {
        PublicationPriority::Background
    }
}
