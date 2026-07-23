use std::path::Path;

use rusqlite::{params, Connection};

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTaskStatus};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_writer,
};
use crate::services::workspace_index_task_status_service::current_time_millis;

pub fn create_index_event_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_events (
                event_id text primary key,
                root_path text not null,
                scope text not null,
                kind text not null,
                phase text not null,
                severity text not null,
                message text not null,
                task_id text,
                generation integer,
                payload_json text not null,
                created_at integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_index_events_recent
             on workspace_index_events(root_path, created_at)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_index_events_task
             on workspace_index_events(root_path, task_id)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn store_index_event(root_path: &str, event: &WorkspaceIndexEvent) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_writer(root_path, |connection| {
        store_index_event_in_connection(connection, event)
    })
}

pub fn store_index_event_in_connection(
    connection: &Connection,
    event: &WorkspaceIndexEvent,
) -> Result<(), String> {
    create_index_event_tables(connection)?;
    connection
        .execute(
            "insert or replace into workspace_index_events (
                event_id, root_path, scope, kind, phase, severity, message,
                task_id, generation, payload_json, created_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                event.event_id,
                event.root_path,
                event.scope,
                event.kind,
                event.phase,
                event.severity,
                event.message,
                event.task_id,
                event.generation.map(|value| value as i64),
                event.payload_json,
                event.created_at as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_recent_index_events(
    root_path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceIndexEvent>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(Vec::new());
    };
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select event_id, root_path, scope, kind, phase, severity, message,
                    task_id, generation, payload_json, created_at
             from workspace_index_events
             where root_path = ?1
             order by created_at desc
             limit ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, limit as i64], |row| {
            Ok(WorkspaceIndexEvent {
                event_id: row.get(0)?,
                root_path: row.get(1)?,
                scope: row.get(2)?,
                kind: row.get(3)?,
                phase: row.get(4)?,
                severity: row.get(5)?,
                message: row.get(6)?,
                task_id: row.get(7)?,
                generation: row.get::<_, Option<i64>>(8)?.map(|value| value as u64),
                payload_json: row.get(9)?,
                created_at: row.get::<_, i64>(10)? as u128,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut events = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    events.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.generation.cmp(&right.generation))
            .then_with(|| event_phase_order(&left.phase).cmp(&event_phase_order(&right.phase)))
            .then_with(|| left.event_id.cmp(&right.event_id))
    });
    Ok(events)
}

fn event_phase_order(phase: &str) -> u8 {
    match phase {
        "queued" => 0,
        "running" => 1,
        "ready" | "partial" | "failed" | "cancelled" | "superseded" => 2,
        _ => 3,
    }
}

pub fn event_from_task_status(
    root_path: &str,
    status: &WorkspaceIndexTaskStatus,
) -> WorkspaceIndexEvent {
    let created_at = status
        .finished_at
        .or(status.started_at)
        .unwrap_or_else(current_time_millis);
    WorkspaceIndexEvent {
        event_id: format!("{}:{}:{created_at}", status.task_id, status.status),
        root_path: normalize_index_path(root_path),
        scope: "task".to_string(),
        kind: status.kind.to_string(),
        phase: status.status.to_string(),
        severity: severity_for_task_status(&status.status).to_string(),
        message: message_for_task_status(status),
        task_id: Some(status.task_id.to_string()),
        generation: Some(status.generation),
        payload_json: serde_json::to_string(status).unwrap_or_else(|_| "{}".to_string()),
        created_at,
    }
}

fn severity_for_task_status(status: &str) -> &'static str {
    match status {
        "failed" => "error",
        "partial" | "stale" => "warning",
        _ => "info",
    }
}

fn message_for_task_status(status: &WorkspaceIndexTaskStatus) -> String {
    status
        .error
        .clone()
        .or_else(|| status.message.clone())
        .unwrap_or_else(|| format!("{} {}", status.kind, status.status))
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
