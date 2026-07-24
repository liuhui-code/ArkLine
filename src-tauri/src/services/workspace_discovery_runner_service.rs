use std::path::Path;

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_discovery_service::{
    discover_workspace_chunk, workspace_discovery_cursor_identity, WorkspaceDiscoveryChunk,
    WorkspaceDiscoveryCursor, WorkspaceDiscoveryCursorIdentity,
};
use crate::services::workspace_discovery_store_service::{
    count_discovered_files_in_connection, load_discovery_state_in_connection,
    prune_discovered_files_except_generation_in_connection,
    replace_discovered_file_chunk_in_connection, update_discovery_state_in_connection,
    WorkspaceDiscoveryState,
};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_task_journal_service::store_task_status_in_connection;
use crate::services::workspace_index_task_status_service::current_time_millis;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceDiscoveryChunk {
    pub(crate) root_path: String,
    pub(crate) cursor: Option<WorkspaceDiscoveryCursor>,
    pub(crate) generation: i64,
    pub(crate) reason: Option<String>,
    #[serde(default)]
    pub(crate) cursor_identity: Option<WorkspaceDiscoveryCursorIdentity>,
    pub(crate) chunk: WorkspaceDiscoveryChunk,
}

pub fn run_workspace_discovery_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
    generation: i64,
) -> Result<WorkspaceDiscoveryChunk, String> {
    run_discovery_chunk(root_path, cursor, limit, generation, None)
}

pub fn run_workspace_discovery_chunk_with_journal(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
    generation: i64,
    reason: &str,
) -> Result<WorkspaceDiscoveryChunk, String> {
    run_discovery_chunk(root_path, cursor, limit, generation, Some(reason))
}

fn run_discovery_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
    generation: i64,
    journal_reason: Option<&str>,
) -> Result<WorkspaceDiscoveryChunk, String> {
    let prepared =
        prepare_workspace_discovery_chunk(root_path, cursor, limit, generation, journal_reason)?;
    publish_prepared_workspace_discovery_chunk(&prepared)?;
    Ok(prepared.chunk)
}

pub(crate) fn prepare_workspace_discovery_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
    generation: i64,
    journal_reason: Option<&str>,
) -> Result<PreparedWorkspaceDiscoveryChunk, String> {
    prepare_workspace_discovery_chunk_with_identity(
        root_path,
        cursor,
        None,
        limit,
        generation,
        journal_reason,
    )
}

pub(crate) fn prepare_workspace_discovery_chunk_with_identity(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    cursor_identity: Option<WorkspaceDiscoveryCursorIdentity>,
    limit: usize,
    generation: i64,
    journal_reason: Option<&str>,
) -> Result<PreparedWorkspaceDiscoveryChunk, String> {
    let root_key = root_path.to_string_lossy().to_string();
    if let Some(chunk) = existing_outcome(
        load_existing_discovery_state(&root_key)?.as_ref(),
        &cursor,
        cursor_identity.as_ref(),
        generation,
    )? {
        return Ok(PreparedWorkspaceDiscoveryChunk {
            root_path: root_key,
            cursor,
            generation,
            reason: journal_reason.map(str::to_string),
            cursor_identity,
            chunk,
        });
    }
    let chunk = discover_workspace_chunk(root_path, cursor.clone(), limit)?;
    Ok(PreparedWorkspaceDiscoveryChunk {
        root_path: root_key,
        cursor,
        generation,
        reason: journal_reason.map(str::to_string),
        cursor_identity,
        chunk,
    })
}

pub(crate) fn publish_prepared_workspace_discovery_chunk(
    prepared: &PreparedWorkspaceDiscoveryChunk,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("discoveryCommit", || {
        with_workspace_index_transaction(
            &prepared.root_path,
            ensure_workspace_index_schema,
            |transaction| {
                if let Some(chunk) = existing_outcome(
                    load_discovery_state_in_connection(transaction, &prepared.root_path)?.as_ref(),
                    &prepared.cursor,
                    prepared.cursor_identity.as_ref(),
                    prepared.generation,
                )? {
                    return Ok(chunk);
                }

                replace_discovered_file_chunk_in_connection(
                    transaction,
                    &prepared.root_path,
                    prepared.generation,
                    &prepared.chunk.files,
                )?;
                if !prepared.chunk.has_more {
                    prune_discovered_files_except_generation_in_connection(
                        transaction,
                        &prepared.root_path,
                        prepared.generation,
                    )?;
                }
                let discovered_count =
                    count_discovered_files_in_connection(transaction, &prepared.root_path)?;
                update_discovery_state_in_connection(
                    transaction,
                    &WorkspaceDiscoveryState {
                        root_path: prepared.root_path.clone(),
                        generation: prepared.generation,
                        status: discovery_state_status(&prepared.chunk).to_string(),
                        discovered_count,
                        excluded_count: prepared.chunk.excluded_count,
                        cursor: prepared.chunk.cursor.clone(),
                        error: None,
                    },
                )?;
                if let Some(reason) = prepared.reason.as_deref() {
                    store_task_status_in_connection(
                        transaction,
                        &prepared.root_path,
                        &discovery_task_status(
                            &prepared.root_path,
                            prepared.generation,
                            reason,
                            &prepared.chunk,
                        ),
                    )?;
                }
                Ok(prepared.chunk.clone())
            },
        )
    })?;
    let mut profile = profiler.finish();
    profile.root_path = prepared.root_path.clone();
    Ok(profile)
}

fn load_existing_discovery_state(
    root_path: &str,
) -> Result<Option<WorkspaceDiscoveryState>, String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(None);
    };
    let table_exists = connection
        .query_row(
            "select 1 from sqlite_master
             where type = 'table' and name = 'workspace_discovery_state'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    if !table_exists {
        return Ok(None);
    }
    load_discovery_state_in_connection(&connection, root_path)
}

fn existing_outcome(
    existing: Option<&WorkspaceDiscoveryState>,
    cursor: &Option<WorkspaceDiscoveryCursor>,
    cursor_identity: Option<&WorkspaceDiscoveryCursorIdentity>,
    generation: i64,
) -> Result<Option<WorkspaceDiscoveryChunk>, String> {
    let Some(existing) = existing else {
        return Ok(None);
    };
    if existing.generation > generation {
        return Err(format!(
            "Stale discovery generation {generation}; durable generation is {}",
            existing.generation
        ));
    }
    if existing.generation == generation {
        if let Some(expected_identity) = cursor_identity {
            let durable_identity = existing
                .cursor
                .as_ref()
                .map(workspace_discovery_cursor_identity);
            if durable_identity.as_ref() != Some(expected_identity) {
                return Err(
                    "Partitioned discovery cursor no longer matches durable state".to_string(),
                );
            }
        } else if existing.cursor != *cursor {
            return Ok(Some(replay_chunk(existing)));
        }
    }
    if existing.generation < generation && cursor.is_some() {
        return Err("A new discovery generation must start without a cursor".to_string());
    }
    if existing.generation == generation && existing.status == "ready" {
        return Ok(Some(replay_chunk(existing)));
    }
    Ok(None)
}

fn replay_chunk(existing: &WorkspaceDiscoveryState) -> WorkspaceDiscoveryChunk {
    WorkspaceDiscoveryChunk {
        files: Vec::new(),
        has_more: existing.cursor.is_some(),
        cursor: existing.cursor.clone(),
        excluded_count: existing.excluded_count,
    }
}

fn discovery_task_status(
    root_path: &str,
    generation: i64,
    reason: &str,
    chunk: &WorkspaceDiscoveryChunk,
) -> WorkspaceIndexTaskStatus {
    let now = current_time_millis();
    let progress_total = if chunk.has_more {
        chunk.files.len().saturating_add(1)
    } else {
        chunk.files.len()
    };
    WorkspaceIndexTaskStatus {
        task_id: format!("{generation}:discovery"),
        root_path: root_path.to_string(),
        kind: "discovery".to_string(),
        status: discovery_status(chunk).to_string(),
        reason: reason.to_string(),
        generation: generation as u64,
        progress_current: chunk.files.len(),
        progress_total,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(now),
        finished_at: Some(now),
        last_heartbeat_at: Some(now),
        stalled: false,
        symbol_count: None,
        message: Some(format!(
            "Discovered {} file(s), excluded {} entries",
            chunk.files.len(),
            chunk.excluded_count
        )),
        error: None,
    }
}

fn discovery_status(chunk: &WorkspaceDiscoveryChunk) -> &'static str {
    if chunk.has_more {
        "partial"
    } else {
        "ready"
    }
}

fn discovery_state_status(chunk: &WorkspaceDiscoveryChunk) -> &'static str {
    if chunk.has_more {
        "running"
    } else {
        "ready"
    }
}
