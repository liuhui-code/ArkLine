use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus};
use crate::services::workspace_discovery_task_service::{
    discovery_task_kind_label, is_workspace_discovery_task_reason,
};
use crate::services::workspace_index_chunk_service::WorkspaceIndexRefreshContinuation;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind,
};
use crate::services::workspace_index_state_machine_service::{
    task_state_label, transition_task_state, WorkspaceIndexTaskState,
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
    pub refresh_continuation: Option<WorkspaceIndexRefreshContinuation<String>>,
    pub sdk_path: Option<String>,
    pub sdk_version: Option<String>,
    pub sdk_remaining_files: Vec<String>,
    pub sdk_symbol_count: Option<usize>,
    pub progress_current: usize,
    pub progress_total: usize,
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
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
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
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
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
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
    }
}

pub fn superseded_task_result(mut result: WorkspaceIndexTaskResult) -> WorkspaceIndexTaskResult {
    result.status = "superseded".to_string();
    result.message = Some("Replaced by a newer index task".to_string());
    result.error = None;
    result.refresh_result = None;
    result.refresh_continuation = None;
    result.sdk_path = None;
    result.sdk_version = None;
    result.sdk_remaining_files = Vec::new();
    result.sdk_symbol_count = None;
    result.progress_current = 1;
    result.progress_total = 1;
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
        refresh_continuation: None,
        sdk_path: None,
        sdk_version: None,
        sdk_remaining_files: Vec::new(),
        sdk_symbol_count: None,
        progress_current: 1,
        progress_total: 1,
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
    let now = current_time_millis();
    let kind = task_status_kind_label(task);
    WorkspaceIndexTaskStatus {
        task_id: task_id(&task.generation, kind),
        root_path: task.root_path.to_string(),
        kind: kind.to_string(),
        status: status.to_string(),
        reason: task.reason.to_string(),
        generation: task.generation,
        progress_current: if terminal { 1 } else { 0 },
        progress_total: 1,
        started_at: running.then_some(now),
        last_heartbeat_at: running.then_some(now),
        stalled: false,
        finished_at: terminal.then_some(now),
        symbol_count,
        message,
        error: None,
    }
}

fn task_status_kind_label(task: &WorkspaceIndexTask) -> &'static str {
    if task.kind == WorkspaceIndexTaskKind::ChangedPaths
        && is_workspace_discovery_task_reason(&task.reason)
    {
        return discovery_task_kind_label();
    }
    task_kind_label(&task.kind)
}

pub fn task_status_from_state_transition(
    task: &WorkspaceIndexTask,
    current: WorkspaceIndexTaskState,
    next: WorkspaceIndexTaskState,
    symbol_count: Option<usize>,
    message: Option<String>,
) -> Result<WorkspaceIndexTaskStatus, String> {
    transition_task_state(current, next)?;
    Ok(task_status_from_task(
        task,
        task_state_label(next),
        symbol_count,
        message,
    ))
}

pub fn task_status_from_result_transition(
    result: &WorkspaceIndexTaskResult,
    current: WorkspaceIndexTaskState,
) -> Result<WorkspaceIndexTaskStatus, String> {
    let next = result_state_from_status(&result.status)?;
    transition_task_state(current, next)?;
    Ok(task_status_from_result(result))
}

pub fn task_status_from_publishable_result(
    result: &WorkspaceIndexTaskResult,
) -> Result<WorkspaceIndexTaskStatus, String> {
    if result.status == "skipped" {
        return Ok(task_status_from_result(result));
    }
    task_status_from_result_transition(result, WorkspaceIndexTaskState::Running)
}

fn result_state_from_status(status: &str) -> Result<WorkspaceIndexTaskState, String> {
    match status {
        "ready" => Ok(WorkspaceIndexTaskState::Ready),
        "partial" => Ok(WorkspaceIndexTaskState::Partial),
        "failed" => Ok(WorkspaceIndexTaskState::Failed),
        "superseded" => Ok(WorkspaceIndexTaskState::Superseded),
        value => Err(format!(
            "Unsupported workspace index task result status: {value}"
        )),
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
        progress_current: result.progress_current,
        progress_total: result.progress_total,
        started_at: result.started_at,
        last_heartbeat_at: result.finished_at.or(result.started_at),
        stalled: false,
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
