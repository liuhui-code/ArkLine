use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_event_service::{event_from_task_status, store_index_event};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub fn store_task_status(root_path: &str, status: &WorkspaceIndexTaskStatus) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    connection
        .execute(
            "insert into workspace_index_task_journal (
                root_path, task_id, kind, status, reason, generation,
                progress_current, progress_total, started_at, finished_at,
                last_heartbeat_at, stalled, symbol_count, message, error, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, strftime('%s','now') * 1000)
             on conflict(root_path, task_id) do update set
                kind = excluded.kind,
                status = excluded.status,
                reason = excluded.reason,
                generation = excluded.generation,
                progress_current = excluded.progress_current,
                progress_total = excluded.progress_total,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                last_heartbeat_at = excluded.last_heartbeat_at,
                stalled = excluded.stalled,
                symbol_count = excluded.symbol_count,
                message = excluded.message,
                error = excluded.error,
                updated_at = excluded.updated_at",
            params![
                root_key,
                status.task_id,
                status.kind,
                status.status,
                status.reason,
                status.generation as i64,
                status.progress_current as i64,
                status.progress_total as i64,
                status.started_at.map(|value| value as i64),
                status.finished_at.map(|value| value as i64),
                status.last_heartbeat_at.map(|value| value as i64),
                if status.stalled { 1_i64 } else { 0_i64 },
                status.symbol_count.map(|value| value as i64),
                status.message,
                status.error,
            ],
        )
        .map_err(|error| error.to_string())?;
    let event = event_from_task_status(root_path, status);
    store_index_event(root_path, &event)?;
    Ok(())
}

pub fn load_recent_task_statuses(
    root_path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceIndexTaskStatus>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(Vec::new());
    }
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select task_id, root_path, kind, status, reason, generation,
                    progress_current, progress_total, started_at, finished_at,
                    last_heartbeat_at, stalled, symbol_count, message, error
             from workspace_index_task_journal
             where root_path = ?1
             order by generation desc, updated_at desc
             limit ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, limit as i64], |row| {
            Ok(WorkspaceIndexTaskStatus {
                task_id: row.get(0)?,
                root_path: row.get(1)?,
                kind: row.get(2)?,
                status: row.get(3)?,
                reason: row.get(4)?,
                generation: row.get::<_, i64>(5)? as u64,
                progress_current: row.get::<_, i64>(6)? as usize,
                progress_total: row.get::<_, i64>(7)? as usize,
                started_at: row.get::<_, Option<i64>>(8)?.map(|value| value as u128),
                finished_at: row.get::<_, Option<i64>>(9)?.map(|value| value as u128),
                last_heartbeat_at: row.get::<_, Option<i64>>(10)?.map(|value| value as u128),
                stalled: row.get::<_, i64>(11)? != 0,
                symbol_count: row.get::<_, Option<i64>>(12)?.map(|value| value as usize),
                message: row.get(13)?,
                error: row.get(14)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut statuses = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    statuses.sort_by(|left, right| left.generation.cmp(&right.generation));
    Ok(statuses)
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace task journal path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
