use rusqlite::{params, Connection, Statement};

use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_content_refresh_service::{
    PreparedWorkspaceContentFile, PreparedWorkspaceContentRefresh,
};
use crate::services::workspace_file_identity_service::ensure_workspace_file_id;
use crate::services::workspace_index_layer_generation_service::{
    publish_layer_generation, CONTENT_LAYER, CONTENT_SUBSTRING_LAYER,
};

pub(crate) fn publish_content_core_profiled(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("contentCoreDelete", || {
        delete_paths(
            connection,
            root_key,
            prepared,
            &[
                "workspace_content_lines",
                "workspace_content_fts",
                "workspace_content_files",
            ],
        )
    })?;
    profiler.measure("contentCoreInsert", || {
        insert_core_files(connection, root_key, &prepared.files)
    })?;
    profiler.measure("contentCoreState", || {
        publish_file_states(connection, root_key, prepared, "workspace_content_files")
    })?;
    profiler.measure("contentSubstringInvalidate", || {
        invalidate_substring_states(connection, root_key, prepared)
    })?;
    profiler.measure("contentCoreGeneration", || {
        publish_layer_generation(
            connection,
            root_key,
            CONTENT_LAYER,
            prepared.indexed_generation,
        )
    })?;
    Ok(profiler.finish())
}

pub(crate) fn publish_content_substring_profiled(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("contentSubstringDelete", || {
        delete_paths(
            connection,
            root_key,
            prepared,
            &[
                "workspace_content_trigram_fts",
                "workspace_content_substring_files",
            ],
        )
    })?;
    profiler.measure("contentSubstringInsert", || {
        insert_substring_files(connection, root_key, &prepared.files)
    })?;
    profiler.measure("contentSubstringState", || {
        publish_file_states(
            connection,
            root_key,
            prepared,
            "workspace_content_substring_files",
        )
    })?;
    profiler.measure("contentSubstringGeneration", || {
        publish_layer_generation(
            connection,
            root_key,
            CONTENT_SUBSTRING_LAYER,
            prepared.indexed_generation,
        )
    })?;
    Ok(profiler.finish())
}

pub(crate) fn clear_workspace_content(
    connection: &Connection,
    root_key: &str,
) -> Result<(), String> {
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_files",
        "workspace_content_trigram_fts",
        "workspace_content_substring_files",
    ] {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1"),
                params![root_key],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn existing_content_paths<'a>(
    connection: &Connection,
    root_key: &str,
    candidates: &[&'a String],
) -> Result<Vec<&'a str>, String> {
    let mut statement = connection
        .prepare(
            "select exists(
                select 1 from workspace_content_files
                where root_path = ?1 and path = ?2
             )",
        )
        .map_err(|error| error.to_string())?;
    let mut existing = Vec::new();
    for path in candidates {
        if statement
            .query_row(params![root_key, path], |row| row.get::<_, bool>(0))
            .map_err(|error| error.to_string())?
        {
            existing.push(path.as_str());
        }
    }
    Ok(existing)
}

fn delete_paths(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
    tables: &[&str],
) -> Result<(), String> {
    for path in prepared
        .removed_paths
        .iter()
        .chain(prepared.refreshed_paths.iter())
    {
        for table in tables {
            connection
                .execute(
                    &format!("delete from {table} where root_path = ?1 and path = ?2"),
                    params![root_key, path],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn insert_core_files(
    connection: &Connection,
    root_key: &str,
    files: &[PreparedWorkspaceContentFile],
) -> Result<(), String> {
    let mut lines = prepare_insert(connection, "workspace_content_lines")?;
    let mut tokens = prepare_insert(connection, "workspace_content_fts")?;
    for file in files {
        let file_id = ensure_workspace_file_id(connection, root_key, &file.path)?;
        insert_file_lines([&mut lines, &mut tokens], root_key, file, file_id)?;
    }
    Ok(())
}

fn insert_substring_files(
    connection: &Connection,
    root_key: &str,
    files: &[PreparedWorkspaceContentFile],
) -> Result<(), String> {
    let mut trigrams = prepare_insert(connection, "workspace_content_trigram_fts")?;
    for file in files {
        let file_id = ensure_workspace_file_id(connection, root_key, &file.path)?;
        insert_file_lines([&mut trigrams], root_key, file, file_id)?;
    }
    Ok(())
}

fn invalidate_substring_states(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
) -> Result<(), String> {
    for path in &prepared.removed_paths {
        connection
            .execute(
                "delete from workspace_content_substring_files
                 where root_path = ?1 and path = ?2",
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }
    let generation = i64::try_from(prepared.indexed_generation)
        .map_err(|_| "Content index generation exceeds SQLite integer range".to_string())?;
    for path in &prepared.refreshed_paths {
        let ready_for_substring = prepared.files.iter().any(|file| file.path == *path);
        let skipped = prepared.skips.iter().find(|item| item.path == *path);
        let (status, error) = if ready_for_substring {
            ("pending", None)
        } else if let Some(skipped) = skipped {
            ("skipped", Some(skipped.reason.as_str()))
        } else {
            ("failed", None)
        };
        connection
            .execute(
                "insert into workspace_content_substring_files (
                    root_path, path, indexed_generation, line_count, status, error, updated_at
                 ) values (?1, ?2, ?3, 0, ?4, ?5, strftime('%s','now') * 1000)
                 on conflict(root_path, path) do update set
                    indexed_generation = excluded.indexed_generation,
                    line_count = 0,
                    status = excluded.status,
                    error = excluded.error,
                    updated_at = excluded.updated_at",
                params![root_key, path, generation, status, error],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn insert_file_lines<const N: usize>(
    mut statements: [&mut Statement<'_>; N],
    root_key: &str,
    file: &PreparedWorkspaceContentFile,
    file_id: i64,
) -> Result<(), String> {
    for (line_index, line_text) in file.content.lines().enumerate() {
        for statement in &mut statements {
            statement
                .execute(params![
                    root_key,
                    file.path,
                    file_id,
                    (line_index + 1) as i64,
                    line_text
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn publish_file_states(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceContentRefresh,
    table: &str,
) -> Result<(), String> {
    let generation = i64::try_from(prepared.indexed_generation)
        .map_err(|_| "Content index generation exceeds SQLite integer range".to_string())?;
    let sql = format!(
        "insert into {table} (
            root_path, path, indexed_generation, line_count, status, error, updated_at
         ) values (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now') * 1000)
         on conflict(root_path, path) do update set
            indexed_generation = excluded.indexed_generation,
            line_count = excluded.line_count,
            status = excluded.status,
            error = excluded.error,
            updated_at = excluded.updated_at"
    );
    for path in &prepared.refreshed_paths {
        let indexed = prepared.files.iter().find(|file| file.path == *path);
        let skipped = prepared.skips.iter().find(|item| item.path == *path);
        let failure = prepared.failures.iter().find(|item| item.path == *path);
        let (status, line_count, error) = indexed.map_or_else(
            || {
                if let Some(skipped) = skipped {
                    return ("skipped", 0, Some(skipped.reason.as_str()));
                }
                (
                    "failed",
                    0,
                    Some(
                        failure
                            .map(|item| item.error.as_str())
                            .unwrap_or("Source file could not be indexed"),
                    ),
                )
            },
            |file| ("ready", file.line_count as i64, None),
        );
        connection
            .execute(
                &sql,
                params![root_key, path, generation, line_count, status, error],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn prepare_insert<'a>(connection: &'a Connection, table: &str) -> Result<Statement<'a>, String> {
    connection
        .prepare(&format!(
            "insert into {table} (root_path, path, file_id, line, text)
             values (?1, ?2, ?3, ?4, ?5)"
        ))
        .map_err(|error| error.to_string())
}
