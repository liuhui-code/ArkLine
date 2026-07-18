use std::path::Path;

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_discovery_service::{
    discover_workspace_chunk, WorkspaceDiscoveryChunk, WorkspaceDiscoveryCursor,
};
use crate::services::workspace_discovery_store_service::{
    count_discovered_files_in_connection, load_discovery_state, load_discovery_state_in_connection,
    prune_discovered_files_except_generation_in_connection,
    replace_discovered_file_chunk_in_connection, update_discovery_state_in_connection,
    WorkspaceDiscoveryState,
};
use crate::services::workspace_index_connection_service::with_workspace_index_transaction;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_task_journal_service::store_task_status_in_connection;
use crate::services::workspace_index_task_status_service::current_time_millis;

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
    let root_key = root_path.to_string_lossy().to_string();
    if let Some(chunk) = existing_outcome(
        load_discovery_state(&root_key)?.as_ref(),
        &cursor,
        generation,
    )? {
        return Ok(chunk);
    }
    let discovered = discover_workspace_chunk(root_path, cursor.clone(), limit)?;

    with_workspace_index_transaction(&root_key, ensure_workspace_index_schema, |transaction| {
        if let Some(chunk) = existing_outcome(
            load_discovery_state_in_connection(transaction, &root_key)?.as_ref(),
            &cursor,
            generation,
        )? {
            return Ok(chunk);
        }

        replace_discovered_file_chunk_in_connection(
            transaction,
            &root_key,
            generation,
            &discovered.files,
        )?;
        if !discovered.has_more {
            prune_discovered_files_except_generation_in_connection(
                transaction,
                &root_key,
                generation,
            )?;
        }
        let discovered_count = count_discovered_files_in_connection(transaction, &root_key)?;
        update_discovery_state_in_connection(
            transaction,
            &WorkspaceDiscoveryState {
                root_path: root_key.clone(),
                generation,
                status: discovery_state_status(&discovered).to_string(),
                discovered_count,
                excluded_count: discovered.excluded_count,
                cursor: discovered.cursor.clone(),
                error: None,
            },
        )?;
        if let Some(reason) = journal_reason {
            store_task_status_in_connection(
                transaction,
                &root_key,
                &discovery_task_status(&root_key, generation, reason, &discovered),
            )?;
        }
        Ok(discovered)
    })
}

fn existing_outcome(
    existing: Option<&WorkspaceDiscoveryState>,
    cursor: &Option<WorkspaceDiscoveryCursor>,
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
    if existing.generation == generation && existing.cursor != *cursor {
        return Ok(Some(replay_chunk(existing)));
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
