use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::params;

use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_continuation_task_service::is_full_refresh_continuation_reason;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexResumeScheduleSummary {
    pub root_paths: Vec<String>,
    pub superseded_tasks: Vec<WorkspaceIndexTask>,
}

pub fn save_resume_task(root_path: &str, task: &WorkspaceIndexTask) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let root_key = normalize_index_path(root_path);
    let task_key = resume_task_key(task);
    let changed_paths_json =
        serde_json::to_string(&task.changed_paths).map_err(|error| error.to_string())?;

    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "insert into workspace_index_resume_tasks (
                root_path, task_key, kind, priority, reason, generation,
                changed_paths_json, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%s','now') * 1000)
             on conflict(root_path, task_key) do update set
                kind = excluded.kind,
                priority = excluded.priority,
                reason = excluded.reason,
                generation = excluded.generation,
                changed_paths_json = excluded.changed_paths_json,
                updated_at = excluded.updated_at",
                params![
                    root_key,
                    task_key,
                    task_kind_label(&task.kind),
                    task_priority_value(task.priority),
                    task.reason,
                    task.generation as i64,
                    changed_paths_json,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub fn load_resume_tasks(root_path: &str) -> Result<Vec<WorkspaceIndexTask>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(Vec::new());
    };
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select kind, priority, reason, generation, changed_paths_json
             from workspace_index_resume_tasks
             where root_path = ?1
             order by priority desc, generation asc",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let paths_json: String = row.get(4)?;
            let changed_paths = serde_json::from_str::<Vec<String>>(&paths_json)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
            Ok(WorkspaceIndexTask {
                root_path: root_path.to_string(),
                kind: parse_task_kind(&row.get::<_, String>(0)?),
                priority: parse_task_priority(row.get::<_, i64>(1)?),
                changed_paths,
                sdk_path: None,
                sdk_version: None,
                generation: row.get::<_, i64>(3)? as u64,
                reason: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[allow(dead_code)]
pub fn clear_resume_tasks_for_root(root_path: &str) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "delete from workspace_index_resume_tasks where root_path = ?1",
                params![normalize_index_path(root_path)],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub fn schedule_resume_tasks_from_store(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    root_path: &str,
) -> Result<WorkspaceIndexResumeScheduleSummary, String> {
    let tasks = load_resume_tasks(root_path)?;
    let mut root_paths = Vec::new();
    let mut superseded_tasks = Vec::new();
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;
    for task in tasks {
        let root_path = task.root_path.clone();
        let result = scheduler.schedule_with_result(task);
        if result.scheduled {
            root_paths.push(root_path);
            superseded_tasks.extend(result.superseded_tasks);
        }
    }
    root_paths.sort();
    root_paths.dedup();
    Ok(WorkspaceIndexResumeScheduleSummary {
        root_paths,
        superseded_tasks,
    })
}

pub fn schedule_interrupted_resume_tasks(
    scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
    results: &[WorkspaceIndexTaskResult],
) -> Result<WorkspaceIndexResumeScheduleSummary, String> {
    let interrupted = results
        .iter()
        .filter(|result| {
            matches!(result.status.as_str(), "cancelled" | "superseded")
                && result.kind == "changed-paths"
                && is_full_refresh_continuation_reason(&result.reason)
        })
        .map(|result| (result.root_path.clone(), result.reason.clone()))
        .collect::<HashSet<_>>();
    let mut tasks = Vec::new();
    for (root_path, reason) in interrupted {
        tasks.extend(
            load_resume_tasks(&root_path)?
                .into_iter()
                .filter(|task| task.reason == reason),
        );
    }

    let mut root_paths = Vec::new();
    let mut superseded_tasks = Vec::new();
    let mut scheduler = scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?;
    for task in tasks {
        let already_pending = scheduler
            .pending_tasks_for_root(&task.root_path)
            .iter()
            .any(|pending| pending.kind == task.kind && pending.reason == task.reason);
        if already_pending {
            continue;
        }
        let root_path = task.root_path.clone();
        let result = scheduler.schedule_with_result(task);
        if result.scheduled {
            root_paths.push(root_path);
            superseded_tasks.extend(result.superseded_tasks);
        }
    }
    root_paths.sort();
    root_paths.dedup();
    Ok(WorkspaceIndexResumeScheduleSummary {
        root_paths,
        superseded_tasks,
    })
}

pub fn clear_completed_resume_tasks(results: &[WorkspaceIndexTaskResult]) -> Result<(), String> {
    for result in results {
        if matches!(result.status.as_str(), "ready" | "skipped")
            && result.kind == "changed-paths"
            && is_full_refresh_continuation_reason(&result.reason)
        {
            clear_resume_task(&result.root_path, "changed-paths", &result.reason)?;
        }
    }
    Ok(())
}

fn clear_resume_task(root_path: &str, kind: &str, reason: &str) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "delete from workspace_index_resume_tasks
             where root_path = ?1 and task_key = ?2",
                params![normalize_index_path(root_path), format!("{kind}:{reason}")],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

fn resume_task_key(task: &WorkspaceIndexTask) -> String {
    format!("{}:{}", task_kind_label(&task.kind), task.reason)
}

fn task_kind_label(kind: &WorkspaceIndexTaskKind) -> &'static str {
    match kind {
        WorkspaceIndexTaskKind::OpenWorkspace => "open-workspace",
        WorkspaceIndexTaskKind::RefreshWorkspace => "refresh-workspace",
        WorkspaceIndexTaskKind::ChangedPaths => "changed-paths",
        WorkspaceIndexTaskKind::IndexSdk => "sdk",
    }
}

fn parse_task_kind(kind: &str) -> WorkspaceIndexTaskKind {
    match kind {
        "open-workspace" => WorkspaceIndexTaskKind::OpenWorkspace,
        "refresh-workspace" => WorkspaceIndexTaskKind::RefreshWorkspace,
        "sdk" => WorkspaceIndexTaskKind::IndexSdk,
        _ => WorkspaceIndexTaskKind::ChangedPaths,
    }
}

fn task_priority_value(priority: WorkspaceIndexTaskPriority) -> i64 {
    priority as i64
}

fn parse_task_priority(priority: i64) -> WorkspaceIndexTaskPriority {
    match priority {
        0 => WorkspaceIndexTaskPriority::Background,
        1 => WorkspaceIndexTaskPriority::SdkIndexing,
        2 => WorkspaceIndexTaskPriority::FullRefresh,
        3 => WorkspaceIndexTaskPriority::ChangedFiles,
        4 => WorkspaceIndexTaskPriority::VisibleFiles,
        5 => WorkspaceIndexTaskPriority::Normal,
        6 => WorkspaceIndexTaskPriority::UserBlocking,
        7 => WorkspaceIndexTaskPriority::ForegroundCompletion,
        8 => WorkspaceIndexTaskPriority::ForegroundNavigation,
        _ => WorkspaceIndexTaskPriority::FullRefresh,
    }
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
