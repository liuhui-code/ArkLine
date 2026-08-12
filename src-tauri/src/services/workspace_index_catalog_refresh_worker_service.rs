use crate::indexer_host::IndexerHostRuntime;
use crate::models::workspace::WorkspaceIndexRefreshResult;
use crate::services::workspace_content_chunk_plan_service::take_refresh_chunk;
use crate::services::workspace_index_adaptive_chunk_service::initial_refresh_limits;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_deep_refresh_catalog_service::{
    complete_deep_refresh_catalog, create_deep_refresh_catalog, load_deep_refresh_catalog_batch,
    supersede_deep_refresh_catalog,
};
use crate::services::workspace_index_deep_refresh_cursor_service::{
    advance_deep_refresh_cursor, clear_deep_refresh_cursor, load_deep_refresh_cursor,
    plan_deep_refresh_batch, save_deep_refresh_cursor, start_next_deep_refresh_phase,
    WorkspaceIndexDeepRefreshCursor, WorkspaceIndexDeepRefreshPhase,
};
use crate::services::workspace_index_deep_sidecar_service::{
    update_background_deep_layer_phase, WorkspaceDeepLayerUpdate,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTask;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::{
    refresh_task_result, skipped_task_result, WorkspaceIndexTaskResult,
};
use crate::services::workspace_index_worker_budget_service::effective_deep_layer_path_budget;

pub(crate) const CATALOG_DEEP_REFRESH_MESSAGE: &str = "Catalog deep refresh yielded";
pub(crate) const CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE: &str = "Catalog deep refresh progressed";
const CATALOG_FOREGROUND_PATH_BUDGET: usize = 32;

pub(crate) fn refresh_catalog_deep_layer_chunk<G: Fn() -> bool + Sync>(
    index_runtime: &WorkspaceIndexRuntime,
    indexer: Option<&IndexerHostRuntime>,
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    started_at: u128,
    is_ui_latency_sensitive: &G,
) -> Result<Option<WorkspaceIndexTaskResult>, String> {
    let cursor = load_or_create_cursor(task)?;
    let ui_latency_sensitive_before_page = is_ui_latency_sensitive();
    let budget = catalog_path_budget(task.priority, ui_latency_sensitive_before_page);
    let batch = plan_deep_refresh_batch(Some(&cursor), budget);
    let page_limit = catalog_page_limit(&batch);
    let Some(page) = load_deep_refresh_catalog_batch(
        &task.root_path,
        cursor.catalog_generation,
        Some(batch.after_file_id),
        batch.up_to_file_id,
        page_limit,
    )?
    else {
        return Ok(Some(skipped_task_result(
            task,
            "Deep refresh catalog was superseded",
            started_at,
        )));
    };
    if page.files.is_empty() {
        if let Some(next) = start_next_deep_refresh_phase(&cursor) {
            save_deep_refresh_cursor(&task.root_path, &next)?;
            let state = index_runtime.get_index_state(&task.root_path)?;
            let mut result = yielded_result(task, state, started_at);
            result.message = Some(CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE.to_string());
            return Ok(Some(result));
        }
        complete_deep_refresh_catalog(&task.root_path, cursor.catalog_generation)?;
        clear_deep_refresh_cursor(&task.root_path, &task.reason)?;
        return Ok(Some(skipped_task_result(
            task,
            "Deep refresh catalog complete",
            started_at,
        )));
    }
    let ui_latency_sensitive_at_start = is_ui_latency_sensitive();
    // A newly active UI preempts before starting another sidecar operation. When the
    // UI was already active, keep the paired content/stub range moving with its
    // reduced budget so continuous typing cannot strand the cursor after content.
    let yield_before_sidecar = !ui_latency_sensitive_before_page && ui_latency_sensitive_at_start;
    if yield_before_sidecar {
        let state = index_runtime.get_index_state(&task.root_path)?;
        return Ok(Some(yielded_result(task, state, started_at)));
    }
    let (paths, batch_last_file_id) = select_atomic_catalog_slice(
        &task.root_path,
        &page.files,
        batch.phase,
        ui_latency_sensitive_at_start,
    );
    let state = match update_background_deep_layer_phase(
        index_runtime,
        indexer,
        task,
        token,
        batch.phase,
        &paths,
        ui_latency_sensitive_at_start,
        is_ui_latency_sensitive,
    )? {
        WorkspaceDeepLayerUpdate::Applied(state) => state,
        WorkspaceDeepLayerUpdate::Deferred(state) => {
            return Ok(Some(yielded_result(task, state, started_at)))
        }
        WorkspaceDeepLayerUpdate::Cancelled => return Ok(None),
    };
    let next = advance_deep_refresh_cursor(&cursor, &batch, batch_last_file_id);
    save_deep_refresh_cursor(&task.root_path, &next)?;
    let mut result = refresh_task_result(
        task,
        "changed-paths",
        WorkspaceIndexRefreshResult {
            state,
            changed: true,
            added_paths: paths,
            removed_paths: Vec::new(),
        },
        started_at,
    );
    // Deep indexing is an internal catalog cursor. Publishing its full workspace
    // snapshot would repeatedly serialize and rebuild the complete file tree.
    result.refresh_result = None;
    result.status = "partial".to_string();
    result.message = Some(CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE.to_string());
    Ok(Some(result))
}

fn catalog_page_limit(
    batch: &crate::services::workspace_index_deep_refresh_cursor_service::WorkspaceIndexDeepRefreshBatch,
) -> usize {
    batch.path_budget
}

fn catalog_path_budget(
    priority: crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority,
    ui_latency_sensitive: bool,
) -> usize {
    if priority == crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority::Background {
        return effective_deep_layer_path_budget(priority, ui_latency_sensitive);
    }
    CATALOG_FOREGROUND_PATH_BUDGET
}

fn select_atomic_catalog_slice(
    root_path: &str,
    files: &[crate::services::workspace_index_deep_refresh_catalog_service::WorkspaceIndexDeepRefreshCatalogFile],
    phase: WorkspaceIndexDeepRefreshPhase,
    ui_latency_sensitive: bool,
) -> (Vec<String>, i64) {
    let paths = files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    if phase != WorkspaceIndexDeepRefreshPhase::Content {
        return (
            paths,
            files.last().map(|file| file.file_id).unwrap_or_default(),
        );
    }
    let (_, byte_limit) = initial_refresh_limits(ui_latency_sensitive);
    let chunk = take_refresh_chunk(root_path, &paths, &[], 0, 0, paths.len(), byte_limit)
        .expect("non-empty catalog page must produce a refresh chunk");
    let last_file_id = files[chunk.next_changed_offset.saturating_sub(1)].file_id;
    (chunk.changed_paths, last_file_id)
}

fn load_or_create_cursor(
    task: &WorkspaceIndexTask,
) -> Result<WorkspaceIndexDeepRefreshCursor, String> {
    if let Some(cursor) = load_deep_refresh_cursor(&task.root_path, &task.reason)? {
        if task.changed_paths.is_empty() {
            return Ok(cursor);
        }
        supersede_deep_refresh_catalog(&task.root_path, cursor.catalog_generation)?;
        clear_deep_refresh_cursor(&task.root_path, &task.reason)?;
    }
    if task.changed_paths.is_empty() {
        return Err("Catalog deep refresh continuation is missing its initial catalog".to_string());
    }
    create_deep_refresh_catalog(&task.root_path, task.generation, &task.changed_paths)?;
    let cursor = WorkspaceIndexDeepRefreshCursor {
        task_key: task.reason.clone(),
        catalog_generation: task.generation,
        phase: WorkspaceIndexDeepRefreshPhase::Content,
        last_file_id: 0,
        batch_last_file_id: None,
    };
    save_deep_refresh_cursor(&task.root_path, &cursor)?;
    Ok(cursor)
}

fn yielded_result(
    task: &WorkspaceIndexTask,
    state: crate::models::workspace::WorkspaceIndexState,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    let mut result = refresh_task_result(
        task,
        "changed-paths",
        WorkspaceIndexRefreshResult {
            state,
            changed: false,
            added_paths: Vec::new(),
            removed_paths: Vec::new(),
        },
        started_at,
    );
    // A deferred deep slice also has no user-visible file-tree change. Keep the continuation
    // status lightweight so it cannot serialize the full workspace snapshot while yielding.
    result.refresh_result = None;
    result.status = "partial".to_string();
    result.message = Some(CATALOG_DEEP_REFRESH_MESSAGE.to_string());
    result
}

#[cfg(test)]
mod tests {
    use super::{catalog_path_budget, CATALOG_FOREGROUND_PATH_BUDGET};
    use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

    #[test]
    fn catalog_slice_uses_the_idle_background_publication_budget() {
        assert_eq!(
            catalog_path_budget(WorkspaceIndexTaskPriority::Background, false),
            64
        );
    }

    #[test]
    fn catalog_slice_keeps_one_bounded_publication_unit_during_ui_activity() {
        assert_eq!(
            catalog_path_budget(WorkspaceIndexTaskPriority::Background, true),
            16
        );
    }

    #[test]
    fn foreground_catalog_work_remains_bounded_by_the_initial_slice() {
        assert_eq!(
            catalog_path_budget(WorkspaceIndexTaskPriority::ForegroundNavigation, false),
            CATALOG_FOREGROUND_PATH_BUDGET
        );
    }
}
