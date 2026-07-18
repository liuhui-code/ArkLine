use crate::indexer_host::{
    IndexerContentRefreshAttempt, IndexerHostRuntime, IndexerStubRefreshAttempt,
};
use crate::indexer_sidecar::{
    IndexerTaskKey, INDEXER_CONTENT_REFRESH_PATH_LIMIT, INDEXER_STUB_REFRESH_PATH_LIMIT,
};
use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_content_chunk_plan_service::plan_content_refresh_chunks;
use crate::services::workspace_content_refresh_service::update_workspace_content_at_generation;
use crate::services::workspace_content_refresh_service::WORKSPACE_CONTENT_MAX_CHUNK_BYTES;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_persistence_service::persist_incremental_deep_index_state_with_priority;
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
    let indexed_generation = state.indexed_at.unwrap_or_default() as u64;

    let sidecar_ready = workspace_file_catalog_contains_paths(&task.root_path, changed_paths)?;
    let (content_outcome, stub_outcome) = if sidecar_ready && sidecar_priority(task.priority) {
        refresh_sidecar_layers(indexer, task, token, &state, changed_paths, removed_paths)
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
            indexed_generation,
        )?;
    }
    if token.is_cancelled() {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }

    if !stub_applied_by_sidecar {
        persist_incremental_deep_index_state_with_priority(
            &task.root_path,
            &state,
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
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
) -> (LayerChunkOutcome, LayerChunkOutcome) {
    let Some(indexer) = indexer else {
        return (
            LayerChunkOutcome::Unavailable,
            LayerChunkOutcome::Unavailable,
        );
    };
    let indexed_generation = state.indexed_at.unwrap_or_default() as u64;
    if indexer.supports_parallel_deep_refresh() {
        return std::thread::scope(|scope| {
            let content = scope.spawn(|| {
                refresh_content_chunks(
                    Some(indexer),
                    task,
                    token,
                    indexed_generation,
                    changed_paths,
                    removed_paths,
                )
            });
            let stub = scope.spawn(|| {
                refresh_stub_chunks(
                    Some(indexer),
                    task,
                    token,
                    state,
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
        indexed_generation,
        changed_paths,
        removed_paths,
    );
    let stub = if matches!(content, LayerChunkOutcome::Applied) {
        refresh_stub_chunks(
            Some(indexer),
            task,
            token,
            state,
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
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
) -> LayerChunkOutcome {
    let Some(indexer) = indexer else {
        return LayerChunkOutcome::Unavailable;
    };
    let indexed_generation = state.indexed_at.unwrap_or_default() as u64;
    if indexed_generation == 0 || changed_paths.is_empty() && removed_paths.is_empty() {
        return LayerChunkOutcome::Unavailable;
    }
    for (changed_chunk, removed_chunk) in refresh_chunks(
        changed_paths,
        removed_paths,
        INDEXER_STUB_REFRESH_PATH_LIMIT,
    ) {
        match indexer.refresh_stub_chunk(
            IndexerTaskKey {
                root_path: task.root_path.clone(),
                kind: "stub-refresh".to_string(),
                generation: task.generation,
                reason: task.reason.clone(),
            },
            indexed_generation,
            changed_chunk,
            removed_chunk,
            || token.is_cancelled(),
        ) {
            IndexerStubRefreshAttempt::Applied(_) => {}
            IndexerStubRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerStubRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
        }
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
    for (changed_chunk, removed_chunk) in plan_content_refresh_chunks(
        &task.root_path,
        changed_paths,
        removed_paths,
        INDEXER_CONTENT_REFRESH_PATH_LIMIT,
        WORKSPACE_CONTENT_MAX_CHUNK_BYTES,
    ) {
        match indexer.refresh_content_chunk(
            IndexerTaskKey {
                root_path: task.root_path.clone(),
                kind: "content-refresh".to_string(),
                generation: task.generation,
                reason: task.reason.clone(),
            },
            indexed_generation,
            changed_chunk,
            removed_chunk,
            || token.is_cancelled(),
        ) {
            IndexerContentRefreshAttempt::Applied(_) => {}
            IndexerContentRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerContentRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
        }
    }
    LayerChunkOutcome::Applied
}

fn sidecar_priority(priority: WorkspaceIndexTaskPriority) -> bool {
    matches!(
        priority,
        WorkspaceIndexTaskPriority::Background | WorkspaceIndexTaskPriority::ChangedFiles
    )
}

fn refresh_chunks(
    changed_paths: &[String],
    removed_paths: &[String],
    limit: usize,
) -> Vec<(Vec<String>, Vec<String>)> {
    let mut chunks = Vec::new();
    let mut changed_offset = 0usize;
    let mut removed_offset = 0usize;
    while changed_offset < changed_paths.len() || removed_offset < removed_paths.len() {
        let changed_end = (changed_offset + limit).min(changed_paths.len());
        let changed = changed_paths[changed_offset..changed_end].to_vec();
        let remaining = limit.saturating_sub(changed.len());
        let removed_end = (removed_offset + remaining).min(removed_paths.len());
        let removed = removed_paths[removed_offset..removed_end].to_vec();
        changed_offset = changed_end;
        removed_offset = removed_end;
        chunks.push((changed, removed));
    }
    chunks
}
