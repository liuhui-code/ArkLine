use std::time::Instant;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_index_compaction_service::{
    remove_workspace_index_compaction_candidate, WorkspaceIndexCompactionCandidate,
    WorkspaceIndexCompactionCommit,
};
use crate::services::workspace_index_connection_service::{
    commit_workspace_index_compaction_candidate, with_workspace_index_transaction,
    with_workspace_index_writer,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_schema_version_service::record_workspace_index_schema_versions;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceIndexMaintenanceOperation {
    ResetWorkspace,
    MaintainStore {
        optimize: WorkspaceIndexOptimizeMode,
        checkpoint: bool,
        incremental_vacuum_pages: u32,
    },
    CompactStore {
        candidate: WorkspaceIndexCompactionCandidate,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceIndexOptimizeMode {
    Skip,
    Initial,
    Periodic,
}

const WORKSPACE_INDEX_RESET_TABLES: &[&str] = &[
    "workspace_content_fts",
    "workspace_content_trigram_fts",
    "workspace_local_symbol_references",
    "workspace_symbol_references",
    "workspace_resolved_symbols",
    "workspace_unresolved_symbols",
    "workspace_symbol_trigrams",
    "workspace_symbol_postings",
    "workspace_dependency_reverse",
    "workspace_dependency_edges",
    "workspace_unresolved_imports",
    "workspace_dependency_graph_metadata",
    "workspace_semantic_file_layers",
    "workspace_stub_parse_errors",
    "workspace_stub_exports",
    "workspace_stub_imports",
    "workspace_stub_declarations",
    "workspace_stub_files",
    "workspace_sdk_symbols",
    "workspace_sdk_index_metadata",
    "workspace_symbol_entities",
    "workspace_symbols",
    "workspace_content_lines",
    "workspace_content_files",
    "workspace_file_fingerprints",
    "workspace_index_layer_generations",
    "workspace_discovered_files",
    "workspace_discovery_state",
    "workspace_index_resume_tasks",
    "workspace_index_task_journal",
    "workspace_index_events",
    "workspace_index_metadata",
    "workspace_files",
    "workspace_catalog",
    "workspace_file_identities",
];

pub(crate) fn publish_workspace_index_maintenance(
    root_path: &str,
    operation: WorkspaceIndexMaintenanceOperation,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    match operation {
        WorkspaceIndexMaintenanceOperation::ResetWorkspace => {
            profiler.measure("maintenanceResetCommit", || {
                with_workspace_index_transaction(
                    root_path,
                    |_| Ok(()),
                    |transaction| {
                        ensure_workspace_index_schema(transaction)?;
                        reset_workspace_index_rows(transaction)?;
                        reset_workspace_schema_versions(transaction)
                    },
                )
            })?;
        }
        WorkspaceIndexMaintenanceOperation::MaintainStore {
            optimize,
            checkpoint,
            incremental_vacuum_pages,
        } => run_store_maintenance(
            root_path,
            optimize,
            checkpoint,
            incremental_vacuum_pages,
            &mut profiler,
        )?,
        WorkspaceIndexMaintenanceOperation::CompactStore { candidate } => {
            let started = Instant::now();
            let result = commit_workspace_index_compaction_candidate(root_path, &candidate);
            remove_workspace_index_compaction_candidate(&candidate);
            let outcome = result?;
            profiler.record(compaction_stage_name(outcome), started.elapsed());
        }
    }
    let mut profile = profiler.finish();
    profile.root_path = root_path.to_string();
    Ok(profile)
}

fn compaction_stage_name(outcome: WorkspaceIndexCompactionCommit) -> &'static str {
    match outcome {
        WorkspaceIndexCompactionCommit::Applied { .. } => "maintenanceCopySwapCommit",
        WorkspaceIndexCompactionCommit::DeferredSourceChanged => {
            "maintenanceCopySwapDeferredSourceChanged"
        }
        WorkspaceIndexCompactionCommit::DeferredReadersActive => {
            "maintenanceCopySwapDeferredReaders"
        }
        WorkspaceIndexCompactionCommit::DeferredStoreBusy => "maintenanceCopySwapDeferredBusy",
    }
}

fn run_store_maintenance(
    root_path: &str,
    optimize: WorkspaceIndexOptimizeMode,
    checkpoint: bool,
    incremental_vacuum_pages: u32,
    profiler: &mut WorkspaceIndexPublicationProfiler,
) -> Result<(), String> {
    with_workspace_index_writer(root_path, |connection| {
        match optimize {
            WorkspaceIndexOptimizeMode::Skip => {}
            WorkspaceIndexOptimizeMode::Initial => profiler
                .measure("maintenanceInitialOptimize", || {
                    execute_pragma(connection, "pragma optimize=0x10002;")
                })?,
            WorkspaceIndexOptimizeMode::Periodic => profiler
                .measure("maintenancePeriodicOptimize", || {
                    execute_pragma(connection, "pragma optimize;")
                })?,
        }
        if checkpoint {
            let started = Instant::now();
            let checkpointed = truncate_wal_checkpoint(connection)?;
            profiler.record(
                if checkpointed {
                    "maintenanceTruncateCheckpoint"
                } else {
                    "maintenanceCheckpointDeferred"
                },
                started.elapsed(),
            );
        }
        if incremental_vacuum_pages > 0 {
            profiler.measure("maintenanceIncrementalVacuum", || {
                execute_pragma(
                    connection,
                    &format!("pragma incremental_vacuum({incremental_vacuum_pages});"),
                )
            })?;
        }
        Ok(())
    })
}

fn execute_pragma(connection: &Connection, sql: &str) -> Result<(), String> {
    connection
        .execute_batch(sql)
        .map_err(|error| error.to_string())
}

fn truncate_wal_checkpoint(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row("pragma wal_checkpoint(truncate)", [], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map(|(busy, _, _)| busy == 0)
        .map_err(|error| error.to_string())
}

fn reset_workspace_index_rows(connection: &Connection) -> Result<(), String> {
    for table in WORKSPACE_INDEX_RESET_TABLES {
        connection
            .execute(&format!("delete from {table}"), [])
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "delete from sqlite_sequence where name = 'workspace_file_identities'",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn reset_workspace_schema_versions(connection: &Connection) -> Result<(), String> {
    connection
        .execute("delete from workspace_index_schema_versions", [])
        .map_err(|error| error.to_string())?;
    record_workspace_index_schema_versions(connection)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::Connection;

    use super::{truncate_wal_checkpoint, WORKSPACE_INDEX_RESET_TABLES};
    use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

    #[test]
    fn reset_table_registry_covers_every_workspace_data_table() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_workspace_index_schema(&connection).unwrap();
        let mut statement = connection
            .prepare(
                "select name from sqlite_master
                 where type = 'table' and name like 'workspace_%'",
            )
            .unwrap();
        let tables = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let missing = tables
            .into_iter()
            .filter(|table| table != "workspace_index_schema_versions")
            .filter(|table| !is_fts_shadow_table(table))
            .filter(|table| !WORKSPACE_INDEX_RESET_TABLES.contains(&table.as_str()))
            .collect::<Vec<_>>();

        assert!(missing.is_empty(), "reset registry missed {missing:?}");
    }

    #[test]
    fn maintenance_checkpoint_truncates_the_wal_file() {
        let root = std::env::temp_dir().join(format!(
            "arkline-maintenance-checkpoint-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let store_path = root.join("index.sqlite");
        let connection = Connection::open(&store_path).unwrap();
        connection.execute_batch(
            "pragma journal_mode=wal;
             pragma wal_autocheckpoint=0;
             create table sample(value text not null);
             begin;
             insert into sample
             select hex(randomblob(4096))
             from json_each('[1,2,3,4,5,6,7,8,9,10]');
             commit;",
        ).unwrap();
        let wal_path = root.join("index.sqlite-wal");
        let before = fs::metadata(&wal_path).unwrap().len();

        assert!(truncate_wal_checkpoint(&connection).unwrap());

        let after = fs::metadata(&wal_path).map(|metadata| metadata.len()).unwrap_or(0);
        assert!(before > 0);
        assert_eq!(after, 0, "maintenance left {after} WAL bytes");
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    fn is_fts_shadow_table(table: &str) -> bool {
        table.starts_with("workspace_content_fts_")
            || table.starts_with("workspace_content_trigram_fts_")
    }
}
