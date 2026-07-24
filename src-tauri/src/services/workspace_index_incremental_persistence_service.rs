use rusqlite::Connection;

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexedSymbol};
use crate::services::workspace_incremental_path_plan_service::{
    plan_incremental_index_paths, WorkspaceIncrementalPathPlan,
};
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_entity_persistence_service::{
    persist_metadata_row, replace_changed_files, replace_changed_symbols_for_paths,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_stub_index_service::replace_changed_stub_rows_with_parsed;
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;

#[allow(dead_code)]
pub fn persist_incremental_sqlite_index_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    persist_incremental_sqlite_index_state_with_priority(
        root_path,
        state,
        changed_symbols,
        changed_paths,
        removed_paths,
        WorkspaceIndexTaskPriority::ChangedFiles,
    )
}

pub fn persist_incremental_sqlite_index_state_with_priority(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
    priority: WorkspaceIndexTaskPriority,
) -> Result<(), String> {
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    if path_plan.is_empty() {
        return Ok(());
    }

    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let generation = indexed_generation(state);
    let prepared = prepare_changed_stub_rows(
        &root_key,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
        generation,
        priority,
    );
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        persist_file_symbol_rows(&transaction, &root_key, state, changed_symbols, &path_plan)?;
        replace_changed_stub_rows_with_parsed(&transaction, &root_key, &prepared, generation)?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

pub fn persist_incremental_sqlite_file_symbol_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    if path_plan.is_empty() {
        return Ok(());
    }

    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        persist_file_symbol_rows(&transaction, &root_key, state, changed_symbols, &path_plan)?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

#[allow(dead_code)]
pub fn persist_incremental_sqlite_deep_state(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    persist_incremental_sqlite_deep_state_with_priority(
        root_path,
        state,
        changed_paths,
        removed_paths,
        WorkspaceIndexTaskPriority::FullRefresh,
    )
}

pub fn persist_incremental_sqlite_deep_state_with_priority(
    root_path: &str,
    state: &WorkspaceIndexState,
    changed_paths: &[String],
    removed_paths: &[String],
    priority: WorkspaceIndexTaskPriority,
) -> Result<(), String> {
    let path_plan = plan_incremental_index_paths(changed_paths, removed_paths);
    if path_plan.is_empty() {
        return Ok(());
    }

    let root_key = state
        .root_path
        .clone()
        .unwrap_or_else(|| normalize_index_path(root_path));
    let generation = indexed_generation(state);
    let prepared = prepare_changed_stub_rows(
        &root_key,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
        generation,
        priority,
    );
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        replace_changed_stub_rows_with_parsed(&transaction, &root_key, &prepared, generation)?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

fn persist_file_symbol_rows(
    connection: &Connection,
    root_key: &str,
    state: &WorkspaceIndexState,
    changed_symbols: &[WorkspaceIndexedSymbol],
    path_plan: &WorkspaceIncrementalPathPlan,
) -> Result<(), String> {
    persist_metadata_row(connection, root_key, state)?;
    replace_changed_files(
        connection,
        root_key,
        &path_plan.changed_paths,
        &path_plan.removed_paths,
    )?;
    replace_changed_symbols_for_paths(
        connection,
        root_key,
        changed_symbols,
        &path_plan.affected_paths,
    )
}

fn indexed_generation(state: &WorkspaceIndexState) -> u64 {
    state.indexed_at.unwrap_or_default() as u64
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
