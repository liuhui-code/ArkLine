use crate::services::workspace_discovery_service::WorkspaceDiscoveryChunk;
use crate::services::workspace_discovery_task_service::discovery_task_kind_label;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTask;
use crate::services::workspace_index_task_status_service::{
    current_time_millis, WorkspaceIndexTaskResult,
};

pub fn discovery_task_result(
    task: &WorkspaceIndexTask,
    chunk: &WorkspaceDiscoveryChunk,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    discovery_task_result_from_counts(
        task,
        chunk.files.len(),
        chunk.excluded_count,
        chunk.has_more,
        started_at,
    )
}

pub fn discovery_task_result_from_counts(
    task: &WorkspaceIndexTask,
    file_count: usize,
    excluded_count: usize,
    has_more: bool,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path.clone(),
        kind: discovery_task_kind_label().to_string(),
        status: if has_more { "partial" } else { "ready" }.to_string(),
        reason: task.reason.clone(),
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: Some(format!(
            "Discovered {} file(s), excluded {} entries",
            file_count, excluded_count
        )),
        error: None,
        refresh_result: None,
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: file_count,
        progress_total: if has_more {
            file_count.saturating_add(1)
        } else {
            file_count
        },
    }
}
