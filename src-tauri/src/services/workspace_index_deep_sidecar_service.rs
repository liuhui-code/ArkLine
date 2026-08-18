use crate::indexer_host::{
    IndexerContentPublicationMode, IndexerHostRuntime, IndexerStubRefreshAttempt,
};
use crate::indexer_sidecar::{IndexerTaskKey, INDEXER_STUB_REFRESH_PATH_LIMIT};
use crate::models::workspace::WorkspaceIndexState;
use crate::services::workspace_content_chunk_plan_service::take_refresh_chunk;
use crate::services::workspace_content_refresh_service::update_workspace_content_at_generation;
use crate::services::workspace_content_refresh_service::WORKSPACE_CONTENT_MAX_CHUNK_BYTES;
use crate::services::workspace_file_fingerprint_service::{
    remove_file_fingerprints, update_file_fingerprints,
};
use crate::services::workspace_index_adaptive_chunk_service::AdaptiveRefreshBudget;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_deep_refresh_cursor_service::WorkspaceIndexDeepRefreshPhase;
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

#[path = "workspace_index_deep_content_service.rs"]
mod content;

use content::refresh_content_chunks;

pub(crate) enum WorkspaceDeepLayerUpdate {
    Applied(WorkspaceIndexState),
    Deferred(WorkspaceIndexState),
    Failed(String),
    Cancelled,
}

pub(crate) fn update_background_deep_layer<G: Fn() -> bool + Sync>(
    index_runtime: &WorkspaceIndexRuntime,
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    changed_paths: &[String],
    removed_paths: &[String],
    ui_latency_sensitive_at_start: bool,
    is_ui_latency_sensitive: &G,
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
            ui_latency_sensitive_at_start,
            is_ui_latency_sensitive,
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
    if matches!(content_outcome, LayerChunkOutcome::Deferred)
        || matches!(stub_outcome, LayerChunkOutcome::Deferred)
    {
        return Ok(WorkspaceDeepLayerUpdate::Deferred(state));
    }
    let content_applied_by_sidecar = matches!(content_outcome, LayerChunkOutcome::Applied);
    let stub_applied_by_sidecar = matches!(stub_outcome, LayerChunkOutcome::Applied);
    if content_applied_by_sidecar && stub_applied_by_sidecar {
        publish_deep_fingerprints(task, changed_paths, removed_paths, catalog_generation)?;
        return Ok(WorkspaceDeepLayerUpdate::Applied(state));
    }
    if indexer.is_some_and(IndexerHostRuntime::requires_process_isolation) {
        return degraded_sidecar_update(
            index_runtime,
            indexer.expect("checked indexer runtime"),
            &task.root_path,
            "content and symbol refresh",
        );
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
    publish_deep_fingerprints(task, changed_paths, removed_paths, catalog_generation)?;
    Ok(WorkspaceDeepLayerUpdate::Applied(state))
}

pub(crate) fn update_background_deep_layer_phase<G: Fn() -> bool + Sync>(
    index_runtime: &WorkspaceIndexRuntime,
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    phase: WorkspaceIndexDeepRefreshPhase,
    changed_paths: &[String],
    ui_latency_sensitive_at_start: bool,
    is_ui_latency_sensitive: &G,
) -> Result<WorkspaceDeepLayerUpdate, String> {
    if token.is_cancelled() {
        return Ok(WorkspaceDeepLayerUpdate::Cancelled);
    }
    let state = index_runtime.get_index_state(&task.root_path)?;
    let catalog_generation = state.indexed_at.unwrap_or_default() as u64;
    let indexed_generation = latest_layer_generation(
        &task.root_path,
        match phase {
            WorkspaceIndexDeepRefreshPhase::Content | WorkspaceIndexDeepRefreshPhase::Substring => {
                CONTENT_LAYER
            }
            WorkspaceIndexDeepRefreshPhase::Stub => STUB_LAYER,
        },
    )?
    .unwrap_or_default()
    .max(catalog_generation);
    let sidecar_ready = workspace_file_catalog_contains_paths(&task.root_path, changed_paths)?;
    let outcome = if sidecar_ready && sidecar_priority(task.priority) {
        match phase {
            WorkspaceIndexDeepRefreshPhase::Content => refresh_content_chunks(
                indexer,
                task,
                token,
                indexed_generation,
                changed_paths,
                &[],
                IndexerContentPublicationMode::CoreOnly,
                ui_latency_sensitive_at_start,
                is_ui_latency_sensitive,
            ),
            WorkspaceIndexDeepRefreshPhase::Stub => refresh_stub_chunks(
                indexer,
                task,
                token,
                indexed_generation,
                changed_paths,
                &[],
                ui_latency_sensitive_at_start,
                is_ui_latency_sensitive,
            ),
            WorkspaceIndexDeepRefreshPhase::Substring => refresh_content_chunks(
                indexer,
                task,
                token,
                indexed_generation,
                changed_paths,
                &[],
                IndexerContentPublicationMode::SubstringOnly,
                ui_latency_sensitive_at_start,
                is_ui_latency_sensitive,
            ),
        }
    } else {
        LayerChunkOutcome::Unavailable
    };
    match outcome {
        LayerChunkOutcome::Cancelled => Ok(WorkspaceDeepLayerUpdate::Cancelled),
        LayerChunkOutcome::Deferred => Ok(WorkspaceDeepLayerUpdate::Deferred(state)),
        LayerChunkOutcome::Applied => {
            match phase {
                WorkspaceIndexDeepRefreshPhase::Content => {}
                WorkspaceIndexDeepRefreshPhase::Stub => {
                    publish_deep_fingerprints(task, changed_paths, &[], catalog_generation)?;
                }
                WorkspaceIndexDeepRefreshPhase::Substring => {}
            }
            Ok(WorkspaceDeepLayerUpdate::Applied(state))
        }
        LayerChunkOutcome::Unavailable
            if indexer.is_some_and(IndexerHostRuntime::requires_process_isolation) =>
        {
            degraded_sidecar_update(
                index_runtime,
                indexer.expect("checked indexer runtime"),
                &task.root_path,
                "catalog deep refresh",
            )
        }
        LayerChunkOutcome::Unavailable => {
            match phase {
                WorkspaceIndexDeepRefreshPhase::Content => update_workspace_content_at_generation(
                    &task.root_path,
                    changed_paths,
                    &[],
                    indexed_generation,
                )?,
                WorkspaceIndexDeepRefreshPhase::Stub => {
                    let mut stub_state = state.clone();
                    stub_state.indexed_at = Some(indexed_generation as u128);
                    persist_incremental_deep_index_state_with_priority(
                        &task.root_path,
                        &stub_state,
                        changed_paths,
                        &[],
                        task.priority,
                    )?;
                    publish_deep_fingerprints(task, changed_paths, &[], catalog_generation)?;
                }
                WorkspaceIndexDeepRefreshPhase::Substring => {
                    update_workspace_content_at_generation(
                        &task.root_path,
                        changed_paths,
                        &[],
                        indexed_generation,
                    )?
                }
            }
            Ok(WorkspaceDeepLayerUpdate::Applied(state))
        }
    }
}

fn degraded_sidecar_update(
    index_runtime: &WorkspaceIndexRuntime,
    indexer: &IndexerHostRuntime,
    root_path: &str,
    operation: &str,
) -> Result<WorkspaceDeepLayerUpdate, String> {
    let reason = indexer.degraded_message(operation);
    let state = index_runtime.degrade_workspace_deep_layer(root_path, &reason)?;
    if let Some(error) = indexer.terminal_unavailability_message() {
        return Ok(WorkspaceDeepLayerUpdate::Failed(error));
    }
    Ok(WorkspaceDeepLayerUpdate::Deferred(state))
}

fn publish_deep_fingerprints(
    task: &WorkspaceIndexTask,
    changed_paths: &[String],
    removed_paths: &[String],
    generation: u64,
) -> Result<(), String> {
    update_file_fingerprints(&task.root_path, changed_paths, generation)?;
    remove_file_fingerprints(&task.root_path, removed_paths)
}

#[derive(Clone, Copy)]
pub(super) enum LayerChunkOutcome {
    Applied,
    Deferred,
    Unavailable,
    Cancelled,
}

fn refresh_sidecar_layers<G: Fn() -> bool + Sync>(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    content_generation: u64,
    stub_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
    ui_latency_sensitive_at_start: bool,
    is_ui_latency_sensitive: &G,
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
                    IndexerContentPublicationMode::CoreAndSubstring,
                    ui_latency_sensitive_at_start,
                    is_ui_latency_sensitive,
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
                    ui_latency_sensitive_at_start,
                    is_ui_latency_sensitive,
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
        IndexerContentPublicationMode::CoreAndSubstring,
        ui_latency_sensitive_at_start,
        is_ui_latency_sensitive,
    );
    let stub = if matches!(content, LayerChunkOutcome::Applied) {
        refresh_stub_chunks(
            Some(indexer),
            task,
            token,
            stub_generation,
            changed_paths,
            removed_paths,
            ui_latency_sensitive_at_start,
            is_ui_latency_sensitive,
        )
    } else {
        LayerChunkOutcome::Unavailable
    };
    (content, stub)
}

fn refresh_stub_chunks<G: Fn() -> bool + Sync>(
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    indexed_generation: u64,
    changed_paths: &[String],
    removed_paths: &[String],
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
        INDEXER_STUB_REFRESH_PATH_LIMIT,
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
        let source_bytes = chunk.changed_source_bytes;
        let next_changed_offset = chunk.next_changed_offset;
        let next_removed_offset = chunk.next_removed_offset;
        let mut yielded_for_ui = false;
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
            || {
                yielded_for_ui |= should_defer_background(
                    task,
                    ui_latency_sensitive_at_start,
                    is_ui_latency_sensitive,
                );
                token.is_cancelled() || yielded_for_ui
            },
        ) {
            IndexerStubRefreshAttempt::Applied(result) => budget.observe(
                result.publication_profile.total_duration_us,
                path_count,
                source_bytes,
            ),
            IndexerStubRefreshAttempt::Unavailable => return LayerChunkOutcome::Unavailable,
            IndexerStubRefreshAttempt::Cancelled if yielded_for_ui && !token.is_cancelled() => {
                return LayerChunkOutcome::Deferred;
            }
            IndexerStubRefreshAttempt::Cancelled => return LayerChunkOutcome::Cancelled,
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

pub(super) fn should_defer_background<G: Fn() -> bool>(
    task: &WorkspaceIndexTask,
    ui_latency_sensitive_at_start: bool,
    is_ui_latency_sensitive: &G,
) -> bool {
    task.priority == WorkspaceIndexTaskPriority::Background
        && !ui_latency_sensitive_at_start
        && is_ui_latency_sensitive()
}

pub(super) fn publication_priority(priority: WorkspaceIndexTaskPriority) -> PublicationPriority {
    if matches!(priority, WorkspaceIndexTaskPriority::ChangedFiles) {
        PublicationPriority::Foreground
    } else {
        PublicationPriority::Background
    }
}
