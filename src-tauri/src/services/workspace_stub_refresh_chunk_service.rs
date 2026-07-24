use rusqlite::params;

use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
    workspace_index_writer_metrics,
};
use crate::services::workspace_index_layer_generation_service::{
    reject_stale_layer_generation, STUB_LAYER,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_schema_version_service::verify_workspace_index_schema_versions;
use crate::services::workspace_stub_index_service::{
    normalize_index_path, replace_changed_stub_rows_with_parsed_profiled,
};
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceStubRefreshChunkSummary {
    pub(crate) parsed_file_count: usize,
    pub(crate) parse_error_count: usize,
    pub(crate) publication_profile: WorkspaceIndexPublicationProfile,
}

pub(crate) fn run_workspace_stub_refresh_chunk(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceStubRefreshChunkSummary, String> {
    let root_key = normalize_index_path(root_path);
    reject_paths_outside_catalog(root_path, changed_paths)?;
    reject_stale_generation(root_path, &root_key, indexed_generation)?;
    let prepared = prepare_changed_stub_rows(
        &root_key,
        changed_paths,
        removed_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::Background,
    );
    let publication_profile = publish_prepared_workspace_stub_refresh_chunk(root_path, &prepared)?;
    Ok(WorkspaceStubRefreshChunkSummary {
        parsed_file_count: prepared.stubs.len(),
        parse_error_count: prepared
            .stubs
            .iter()
            .map(|stub| stub.parse_errors.len())
            .sum(),
        publication_profile,
    })
}

pub(crate) fn publish_prepared_workspace_stub_refresh_chunk(
    root_path: &str,
    prepared: &crate::services::workspace_stub_prepare_service::PreparedWorkspaceStubRefresh,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let root_key = normalize_index_path(root_path);
    reject_paths_outside_catalog(root_path, &prepared.plan.indexed_paths)?;
    let indexed_generation = prepared.indexed_generation;
    reject_stale_generation(root_path, &root_key, indexed_generation)?;
    let mut publication_profile = with_workspace_index_transaction(
        root_path,
        verify_workspace_index_schema_versions,
        |transaction| {
            reject_stale_generation_in_connection(transaction, &root_key, indexed_generation)?;
            replace_changed_stub_rows_with_parsed_profiled(
                transaction,
                &root_key,
                &prepared,
                indexed_generation,
            )
        },
    )?;
    publication_profile.root_path = root_path.to_string();
    publication_profile.total_duration_us = workspace_index_writer_metrics(root_path).last_hold_us;
    Ok(publication_profile)
}

pub(crate) fn workspace_file_catalog_contains_paths(
    root_path: &str,
    paths: &[String],
) -> Result<bool, String> {
    let root_key = normalize_index_path(root_path);
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(false);
    };
    Ok(first_path_outside_catalog(&connection, &root_key, paths)?.is_none())
}

fn reject_paths_outside_catalog(root_path: &str, changed_paths: &[String]) -> Result<(), String> {
    let root_key = normalize_index_path(root_path);
    let connection = open_existing_workspace_index_reader(root_path)?
        .ok_or_else(|| "Workspace file index is unavailable for stub refresh".to_string())?;
    if let Some(path) = first_path_outside_catalog(&connection, &root_key, changed_paths)? {
        return Err(format!(
            "Stub refresh path is absent from workspace file index: {path}"
        ));
    }
    Ok(())
}

fn first_path_outside_catalog(
    connection: &rusqlite::Connection,
    root_key: &str,
    paths: &[String],
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "select exists(
                select 1 from workspace_files
                where root_path = ?1 and path in (?2, ?3)
             )",
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        let normalized = normalize_index_path(path);
        let portable = normalized.replace('\\', "/");
        let exists = statement
            .query_row(params![root_key, normalized, portable], |row| {
                row.get::<_, bool>(0)
            })
            .map_err(|error| error.to_string())?;
        if !exists {
            return Ok(Some(normalized));
        }
    }
    Ok(None)
}

fn reject_stale_generation(
    root_path: &str,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(());
    };
    reject_stale_generation_in_connection(&connection, root_key, indexed_generation)
}

fn reject_stale_generation_in_connection(
    connection: &rusqlite::Connection,
    root_key: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    reject_stale_layer_generation(connection, root_key, STUB_LAYER, indexed_generation)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::run_workspace_stub_refresh_chunk;
    use crate::services::workspace_index_service::WorkspaceIndexRuntime;

    #[test]
    fn stub_chunk_reports_each_atomic_publication_stage() {
        let root = std::env::temp_dir().join(format!(
            "arkline-stub-chunk-profile-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("Entry.ets");
        fs::write(&source, "class EntryController {}\n").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let source_path = source.to_string_lossy().to_string();
        WorkspaceIndexRuntime::default()
            .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
            .unwrap();

        let summary =
            run_workspace_stub_refresh_chunk(&root_path, &[source_path], &[], 100).unwrap();
        let stages = summary
            .publication_profile
            .stages
            .iter()
            .map(|stage| stage.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(summary.parsed_file_count, 1);
        assert_eq!(stages.first(), Some(&"stubSemanticState"));
        assert!(stages.contains(&"stubReference"));
        assert_eq!(stages.last(), Some(&"stubGeneration"));
        fs::remove_dir_all(root).unwrap();
    }
}
