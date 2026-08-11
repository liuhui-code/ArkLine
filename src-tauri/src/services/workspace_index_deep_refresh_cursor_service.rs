use std::path::Path;

use rusqlite::{params, OptionalExtension};

use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexDeepRefreshPhase {
    Content,
    Stub,
    Substring,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexDeepRefreshCursor {
    pub task_key: String,
    pub catalog_generation: u64,
    pub phase: WorkspaceIndexDeepRefreshPhase,
    pub last_file_id: i64,
    pub batch_last_file_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexDeepRefreshBatch {
    pub phase: WorkspaceIndexDeepRefreshPhase,
    pub after_file_id: i64,
    pub up_to_file_id: Option<i64>,
    pub path_budget: usize,
}

pub(crate) fn plan_deep_refresh_batch(
    cursor: Option<&WorkspaceIndexDeepRefreshCursor>,
    path_budget: usize,
) -> WorkspaceIndexDeepRefreshBatch {
    let cursor = cursor.cloned().unwrap_or(WorkspaceIndexDeepRefreshCursor {
        task_key: String::new(),
        catalog_generation: 0,
        phase: WorkspaceIndexDeepRefreshPhase::Content,
        last_file_id: 0,
        batch_last_file_id: None,
    });
    WorkspaceIndexDeepRefreshBatch {
        phase: cursor.phase,
        after_file_id: cursor.last_file_id,
        up_to_file_id: cursor.batch_last_file_id,
        path_budget: path_budget.max(1),
    }
}

pub(crate) fn advance_deep_refresh_cursor(
    cursor: &WorkspaceIndexDeepRefreshCursor,
    _batch: &WorkspaceIndexDeepRefreshBatch,
    batch_last_file_id: i64,
) -> WorkspaceIndexDeepRefreshCursor {
    WorkspaceIndexDeepRefreshCursor {
        last_file_id: batch_last_file_id,
        batch_last_file_id: None,
        ..cursor.clone()
    }
}

pub(crate) fn start_next_deep_refresh_phase(
    cursor: &WorkspaceIndexDeepRefreshCursor,
) -> Option<WorkspaceIndexDeepRefreshCursor> {
    let phase = match cursor.phase {
        WorkspaceIndexDeepRefreshPhase::Content => WorkspaceIndexDeepRefreshPhase::Stub,
        WorkspaceIndexDeepRefreshPhase::Stub => WorkspaceIndexDeepRefreshPhase::Substring,
        WorkspaceIndexDeepRefreshPhase::Substring => return None,
    };
    Some(WorkspaceIndexDeepRefreshCursor {
        phase,
        last_file_id: 0,
        batch_last_file_id: None,
        ..cursor.clone()
    })
}

pub(crate) fn save_deep_refresh_cursor(
    root_path: &str,
    cursor: &WorkspaceIndexDeepRefreshCursor,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir()
        || cursor.last_file_id < 0
        || cursor
            .batch_last_file_id
            .is_some_and(|file_id| file_id < cursor.last_file_id)
    {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "insert into workspace_index_deep_refresh_checkpoints (
                    root_path, task_key, catalog_generation, phase,
                    last_file_id, batch_last_file_id, updated_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now') * 1000)
                 on conflict(root_path, task_key) do update set
                    catalog_generation = excluded.catalog_generation,
                    phase = excluded.phase,
                    last_file_id = excluded.last_file_id,
                    batch_last_file_id = excluded.batch_last_file_id,
                    updated_at = excluded.updated_at",
                params![
                    normalize_root_path(root_path),
                    cursor.task_key,
                    cursor.catalog_generation as i64,
                    phase_label(cursor.phase),
                    cursor.last_file_id,
                    cursor.batch_last_file_id,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn load_deep_refresh_cursor(
    root_path: &str,
    task_key: &str,
) -> Result<Option<WorkspaceIndexDeepRefreshCursor>, String> {
    if !Path::new(root_path).is_dir() {
        return Ok(None);
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(None);
    };
    connection
        .query_row(
            "select catalog_generation, phase, last_file_id, batch_last_file_id
             from workspace_index_deep_refresh_checkpoints
             where root_path = ?1 and task_key = ?2",
            params![normalize_root_path(root_path), task_key],
            |row| {
                Ok(WorkspaceIndexDeepRefreshCursor {
                    task_key: task_key.to_string(),
                    catalog_generation: row.get::<_, i64>(0)? as u64,
                    phase: parse_phase(&row.get::<_, String>(1)?),
                    last_file_id: row.get(2)?,
                    batch_last_file_id: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub(crate) fn clear_deep_refresh_cursor(root_path: &str, task_key: &str) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "delete from workspace_index_deep_refresh_checkpoints
                 where root_path = ?1 and task_key = ?2",
                params![normalize_root_path(root_path), task_key],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

fn phase_label(phase: WorkspaceIndexDeepRefreshPhase) -> &'static str {
    match phase {
        WorkspaceIndexDeepRefreshPhase::Content => "content",
        WorkspaceIndexDeepRefreshPhase::Stub => "stub",
        WorkspaceIndexDeepRefreshPhase::Substring => "substring",
    }
}

fn parse_phase(value: &str) -> WorkspaceIndexDeepRefreshPhase {
    match value {
        "stub" => WorkspaceIndexDeepRefreshPhase::Stub,
        "substring" => WorkspaceIndexDeepRefreshPhase::Substring,
        _ => WorkspaceIndexDeepRefreshPhase::Content,
    }
}

fn normalize_root_path(path: &str) -> String {
    path.replace('/', "\\")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        advance_deep_refresh_cursor, clear_deep_refresh_cursor, load_deep_refresh_cursor,
        plan_deep_refresh_batch, save_deep_refresh_cursor, start_next_deep_refresh_phase,
        WorkspaceIndexDeepRefreshCursor, WorkspaceIndexDeepRefreshPhase,
    };

    #[test]
    fn persists_file_identity_checkpoint_per_refresh_task() {
        let root = temp_root("deep-checkpoint-save-load");
        let root_path = root.to_string_lossy().to_string();
        let cursor = WorkspaceIndexDeepRefreshCursor {
            task_key: "changed-paths:full-refresh-deep:workspace".to_string(),
            catalog_generation: 12,
            phase: WorkspaceIndexDeepRefreshPhase::Stub,
            last_file_id: 17,
            batch_last_file_id: Some(24),
        };

        save_deep_refresh_cursor(&root_path, &cursor).unwrap();
        assert_eq!(
            load_deep_refresh_cursor(&root_path, &cursor.task_key).unwrap(),
            Some(cursor)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn advances_within_content_before_starting_stub() {
        let cursor = cursor("phase", 12);
        let content = plan_deep_refresh_batch(Some(&cursor), 7);
        let next = advance_deep_refresh_cursor(&cursor, &content, 19);

        assert_eq!(next.phase, WorkspaceIndexDeepRefreshPhase::Content);
        assert_eq!(next.last_file_id, 19);
        assert_eq!(next.batch_last_file_id, None);
    }

    #[test]
    fn starts_the_next_full_catalog_phase_at_the_beginning() {
        let mut content = cursor("phase", 12);
        content.last_file_id = 19;

        let stub = start_next_deep_refresh_phase(&content).unwrap();
        let substring = start_next_deep_refresh_phase(&stub).unwrap();

        assert_eq!(stub.phase, WorkspaceIndexDeepRefreshPhase::Stub);
        assert_eq!(stub.last_file_id, 0);
        assert_eq!(substring.phase, WorkspaceIndexDeepRefreshPhase::Substring);
        assert!(start_next_deep_refresh_phase(&substring).is_none());
    }

    #[test]
    fn clears_only_the_requested_refresh_task() {
        let root = temp_root("deep-checkpoint-clear");
        let root_path = root.to_string_lossy().to_string();
        let first = cursor("first", 1);
        let second = cursor("second", 2);
        save_deep_refresh_cursor(&root_path, &first).unwrap();
        save_deep_refresh_cursor(&root_path, &second).unwrap();

        clear_deep_refresh_cursor(&root_path, &first.task_key).unwrap();

        assert!(load_deep_refresh_cursor(&root_path, &first.task_key)
            .unwrap()
            .is_none());
        assert_eq!(
            load_deep_refresh_cursor(&root_path, &second.task_key).unwrap(),
            Some(second)
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn cursor(task_key: &str, generation: u64) -> WorkspaceIndexDeepRefreshCursor {
        WorkspaceIndexDeepRefreshCursor {
            task_key: task_key.to_string(),
            catalog_generation: generation,
            phase: WorkspaceIndexDeepRefreshPhase::Content,
            last_file_id: generation as i64,
            batch_last_file_id: None,
        }
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arkline-{name}-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
