use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTask;
use crate::services::workspace_index_task_status_service::{
    current_time_millis, skipped_task_result, superseded_task_result_from_task,
    WorkspaceIndexTaskResult,
};
use crate::services::workspace_sdk_api_scan_plan_service::{
    plan_sdk_api_scan, sdk_api_scan_chunks,
};
use crate::services::workspace_sdk_index_service::{
    index_workspace_sdk_symbol_chunk, mark_workspace_sdk_artifact_ready,
};
use crate::services::workspace_sdk_shared_bridge_service::try_reuse_ready_shared_sdk_artifact;

pub const WORKSPACE_SDK_API_INDEX_CHUNK_SIZE: usize = 128;

pub fn run_sdk_index_task(
    task: &WorkspaceIndexTask,
    token: &WorkspaceIndexCancellationToken,
    started_at: u128,
) -> Result<WorkspaceIndexTaskResult, String> {
    let sdk_path = task
        .sdk_path
        .clone()
        .ok_or_else(|| "SDK index task missing sdk path".to_string())?;
    let sdk_version = task
        .sdk_version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    if token.is_cancelled() {
        return Ok(superseded_task_result_from_task(task));
    }
    if task.changed_paths.is_empty() {
        if let Some(symbol_count) =
            try_reuse_ready_shared_sdk_artifact(&task.root_path, &sdk_path, &sdk_version)?
        {
            let mut result = sdk_task_result(
                task,
                sdk_path,
                sdk_version,
                symbol_count,
                Vec::new(),
                1,
                started_at,
            );
            result.message = Some("Reused shared SDK artifact".to_string());
            return Ok(result);
        }
    }

    let files = sdk_task_files(task, &sdk_path)?;
    if files.is_empty() {
        return Ok(skipped_task_result(
            task,
            "No SDK API files require indexing",
            started_at,
        ));
    }
    let mut chunks = sdk_api_scan_chunks(files, WORKSPACE_SDK_API_INDEX_CHUNK_SIZE);
    let first_chunk = chunks
        .first()
        .cloned()
        .ok_or_else(|| "No SDK API chunk to index".to_string())?;
    if token.is_cancelled() {
        return Ok(superseded_task_result_from_task(task));
    }

    let replace_existing = task.changed_paths.is_empty();
    let summary = index_workspace_sdk_symbol_chunk(
        &task.root_path,
        &sdk_path,
        &sdk_version,
        &first_chunk,
        replace_existing,
    )?;
    let total_chunks = chunks.len();
    let remaining_files = chunks.drain(1..).flatten().collect::<Vec<_>>();
    if remaining_files.is_empty() {
        mark_workspace_sdk_artifact_ready(&task.root_path)?;
    }
    Ok(sdk_task_result(
        task,
        sdk_path,
        sdk_version,
        summary.symbol_count,
        remaining_files,
        total_chunks,
        started_at,
    ))
}

fn sdk_task_files(task: &WorkspaceIndexTask, sdk_path: &str) -> Result<Vec<String>, String> {
    if task.changed_paths.is_empty() {
        Ok(plan_sdk_api_scan(sdk_path)?.files)
    } else {
        Ok(task.changed_paths.clone())
    }
}

fn sdk_task_result(
    task: &WorkspaceIndexTask,
    sdk_path: String,
    sdk_version: String,
    symbol_count: usize,
    remaining_files: Vec<String>,
    total_chunks: usize,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    let partial = !remaining_files.is_empty();
    WorkspaceIndexTaskResult {
        root_path: task.root_path.to_string(),
        kind: "sdk".to_string(),
        status: if partial { "partial" } else { "ready" }.to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: partial.then(|| "SDK API index yielded with remaining chunks".to_string()),
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_path: Some(sdk_path),
        sdk_version: Some(sdk_version),
        sdk_remaining_files: remaining_files,
        sdk_symbol_count: Some(symbol_count),
        progress_current: 1,
        progress_total: total_chunks.max(1),
    }
}
