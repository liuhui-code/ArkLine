use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus};
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind,
};

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct WorkspaceIndexTaskResult {
    pub root_path: String,
    pub kind: String,
    pub status: String,
    pub reason: String,
    pub generation: u64,
    pub started_at: Option<u128>,
    pub finished_at: Option<u128>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub refresh_result: Option<WorkspaceIndexRefreshResult>,
    pub sdk_symbol_count: Option<usize>,
}

pub fn refresh_task_result(
    task: &WorkspaceIndexTask,
    kind: &str,
    refresh_result: WorkspaceIndexRefreshResult,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path.to_string(),
        kind: kind.to_string(),
        status: refresh_result.state.status.to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: None,
        error: None,
        refresh_result: Some(refresh_result),
        sdk_symbol_count: None,
    }
}

pub fn failed_task_result(
    task: WorkspaceIndexTask,
    error: String,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path,
        kind: task_kind_label(&task.kind).to_string(),
        status: "failed".to_string(),
        reason: task.reason,
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: None,
        error: Some(error),
        refresh_result: None,
        sdk_symbol_count: None,
    }
}

pub fn skipped_task_result(
    task: &WorkspaceIndexTask,
    message: &str,
    started_at: u128,
) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path.to_string(),
        kind: task_kind_label(&task.kind).to_string(),
        status: "skipped".to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        started_at: Some(started_at),
        finished_at: Some(current_time_millis()),
        message: Some(message.to_string()),
        error: None,
        refresh_result: None,
        sdk_symbol_count: None,
    }
}

pub fn superseded_task_result(mut result: WorkspaceIndexTaskResult) -> WorkspaceIndexTaskResult {
    result.status = "superseded".to_string();
    result.message = Some("Replaced by a newer index task".to_string());
    result.error = None;
    result.refresh_result = None;
    result.sdk_symbol_count = None;
    result.finished_at = Some(current_time_millis());
    result
}

pub fn superseded_task_result_from_task(task: &WorkspaceIndexTask) -> WorkspaceIndexTaskResult {
    WorkspaceIndexTaskResult {
        root_path: task.root_path.to_string(),
        kind: task_kind_label(&task.kind).to_string(),
        status: "superseded".to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        started_at: None,
        finished_at: Some(current_time_millis()),
        message: Some("Replaced by a newer index task".to_string()),
        error: None,
        refresh_result: None,
        sdk_symbol_count: None,
    }
}

pub fn task_kind_label(kind: &WorkspaceIndexTaskKind) -> &'static str {
    match kind {
        WorkspaceIndexTaskKind::OpenWorkspace => "open-workspace",
        WorkspaceIndexTaskKind::RefreshWorkspace => "refresh-workspace",
        WorkspaceIndexTaskKind::ChangedPaths => "changed-paths",
        WorkspaceIndexTaskKind::IndexSdk => "sdk",
    }
}

pub fn task_status_from_task(
    task: &WorkspaceIndexTask,
    status: &str,
    symbol_count: Option<usize>,
    message: Option<String>,
) -> WorkspaceIndexTaskStatus {
    let running = status == "running";
    let terminal = is_terminal_task_status(status);
    WorkspaceIndexTaskStatus {
        task_id: task_id(&task.generation, task_kind_label(&task.kind)),
        root_path: task.root_path.to_string(),
        kind: task_kind_label(&task.kind).to_string(),
        status: status.to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        progress_current: if terminal { 1 } else { 0 },
        progress_total: 1,
        started_at: running.then(current_time_millis),
        finished_at: terminal.then(current_time_millis),
        symbol_count,
        message,
        error: None,
    }
}

fn is_terminal_task_status(status: &str) -> bool {
    matches!(
        status,
        "ready" | "failed" | "cancelled" | "superseded" | "skipped"
    )
}

pub fn task_status_from_result(result: &WorkspaceIndexTaskResult) -> WorkspaceIndexTaskStatus {
    WorkspaceIndexTaskStatus {
        task_id: task_id(&result.generation, &result.kind),
        root_path: result.root_path.to_string(),
        kind: result.kind.to_string(),
        status: result.status.to_string(),
        reason: result.reason.to_string(),
        generation: result.generation,
        progress_current: 1,
        progress_total: 1,
        started_at: result.started_at,
        finished_at: result.finished_at,
        symbol_count: result.sdk_symbol_count,
        message: result.message.clone(),
        error: result.error.clone(),
    }
}

pub fn task_id(generation: &u64, kind: &str) -> String {
    format!("{generation}:{kind}")
}

pub fn current_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
