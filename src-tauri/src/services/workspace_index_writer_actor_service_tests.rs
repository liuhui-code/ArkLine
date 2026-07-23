use std::fs::{self, File, FileTimes};
use std::time::{Duration, SystemTime};

use super::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest, WorkspaceIndexWriterActor,
};
use crate::services::workspace_content_refresh_service::prepare_workspace_content_refresh;
use crate::services::workspace_discovery_runner_service::prepare_workspace_discovery_chunk;
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_writer,
};
use crate::services::workspace_index_maintenance_publication_service::{
    WorkspaceIndexMaintenanceOperation, WorkspaceIndexOptimizeMode,
};
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;

#[test]
fn writer_actor_publishes_a_prepared_content_artifact() {
    let root = std::env::temp_dir().join(format!("arkline-writer-actor-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Content {
        root_path: root_path.clone(),
        prepared: prepare_workspace_content_refresh(
            &root_path,
            std::slice::from_ref(&source_path),
            &[],
            10,
        ),
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::Background,
        },
        || false,
    );

    assert!(matches!(
        result,
        WorkspaceIndexPublicationAttempt::Applied(_)
    ));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    let content_count: i64 = connection
        .query_row("select count(*) from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(content_count, 1);
    let metrics = actor.snapshot();
    assert_eq!(metrics.sample_count, 1);
    assert_eq!(metrics.active_writer_count, 0);
    assert_eq!(metrics.queued_writer_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writer_actor_publishes_discovery_rows_state_and_journal_atomically() {
    let root = std::env::temp_dir().join(format!(
        "arkline-discovery-writer-actor-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Entry.ets"), "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let prepared =
        prepare_workspace_discovery_chunk(&root, None, 64, 7, Some("writer-actor-discovery"))
            .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Discovery {
        root_path: root_path.clone(),
        prepared,
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::Background,
        },
        || false,
    );

    let WorkspaceIndexPublicationAttempt::Applied(profile) = result else {
        panic!("discovery publication should apply");
    };
    assert!(profile
        .stages
        .iter()
        .any(|stage| stage.name == "discoveryCommit"));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    let discovered_count: i64 = connection
        .query_row(
            "select count(*) from workspace_discovered_files",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let journal_count: i64 = connection
        .query_row(
            "select count(*) from workspace_index_task_journal
             where task_id = '7:discovery' and status = 'ready'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(discovered_count, 1);
    assert_eq!(journal_count, 1);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writer_actor_publishes_a_prepared_stub_artifact() {
    let root = std::env::temp_dir().join(format!(
        "arkline-stub-writer-actor-{}",
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
    let artifact = WorkspaceIndexPublicationArtifact::Stub {
        root_path: root_path.clone(),
        prepared: prepare_changed_stub_rows(
            &root_path.replace('/', "\\"),
            std::slice::from_ref(&source_path),
            &[],
            11,
            WorkspaceIndexTaskPriority::Background,
        ),
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::Background,
        },
        || false,
    );

    assert!(matches!(
        result,
        WorkspaceIndexPublicationAttempt::Applied(_)
    ));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    let stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stub_count, 1);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writer_actor_resets_workspace_rows_and_preserves_a_usable_schema() {
    let root = std::env::temp_dir().join(format!("arkline-maintenance-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, &[source_path], &[])
        .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.clone(),
        operation: WorkspaceIndexMaintenanceOperation::ResetWorkspace,
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::Foreground,
        },
        || false,
    );

    let WorkspaceIndexPublicationAttempt::Applied(profile) = result else {
        panic!("workspace reset should apply");
    };
    assert!(profile
        .stages
        .iter()
        .any(|stage| stage.name == "maintenanceResetCommit"));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    let file_count: i64 = connection
        .query_row("select count(*) from workspace_files", [], |row| row.get(0))
        .unwrap();
    let schema_count: i64 = connection
        .query_row(
            "select count(*) from workspace_index_schema_versions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(file_count, 0);
    assert!(schema_count > 0);
    assert_eq!(actor.snapshot().maintenance_publication_count, 1);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_workspace_reset_rolls_back_every_deleted_index_layer() {
    let root = std::env::temp_dir().join(format!(
        "arkline-maintenance-rollback-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, &[source_path], &[])
        .unwrap();
    with_workspace_index_writer(&root_path, |connection| {
        connection
            .execute_batch(
                "create trigger reject_workspace_reset before delete on workspace_files
                 begin select raise(abort, 'reset blocked'); end;",
            )
            .map_err(|error| error.to_string())
    })
    .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.clone(),
        operation: WorkspaceIndexMaintenanceOperation::ResetWorkspace,
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::Maintenance,
        },
        || false,
    );

    assert!(matches!(
        result,
        WorkspaceIndexPublicationAttempt::Failed(error) if error.contains("reset blocked")
    ));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    for table in ["workspace_files", "workspace_symbols"] {
        let count: i64 = connection
            .query_row(&format!("select count(*) from {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(count > 0, "{table} should survive rollback");
    }
    let metrics = actor.snapshot();
    assert_eq!(metrics.failure_count, 1);
    assert_eq!(metrics.maintenance_publication_count, 0);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writer_actor_runs_bounded_store_maintenance_on_the_idle_lane() {
    let root =
        std::env::temp_dir().join(format!("arkline-idle-maintenance-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(
            &root_path,
            &[source.to_string_lossy().to_string()],
            &[],
        )
        .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.clone(),
        operation: WorkspaceIndexMaintenanceOperation::MaintainStore {
            optimize: WorkspaceIndexOptimizeMode::Initial,
            checkpoint: true,
            incremental_vacuum_pages: 0,
        },
    };
    let descriptor = write_workspace_publication_artifact(&root_path, &artifact).unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.clone(),
            descriptor,
            priority: PublicationPriority::IdleMaintenance,
        },
        || false,
    );

    let WorkspaceIndexPublicationAttempt::Applied(profile) = result else {
        panic!("idle store maintenance should apply");
    };
    assert!(profile
        .stages
        .iter()
        .any(|stage| stage.name == "maintenanceInitialOptimize"));
    assert!(profile
        .stages
        .iter()
        .any(|stage| stage.name == "maintenancePassiveCheckpoint"));
    assert_eq!(actor.snapshot().maintenance_publication_count, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancelled_publication_is_removed_before_it_enters_the_queue() {
    let path = std::env::temp_dir().join(format!(
        "arkline-cancelled-publication-{}.json",
        uuid::Uuid::new_v4()
    ));
    fs::write(&path, "{}").unwrap();
    let actor = WorkspaceIndexWriterActor::new();

    let result = actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: "/cancelled".to_string(),
            descriptor: crate::models::workspace_index_publication::WorkspaceIndexPublicationArtifactDescriptor {
                path: path.to_string_lossy().to_string(),
                byte_count: 2,
            },
            priority: PublicationPriority::Background,
        },
        || true,
    );

    assert_eq!(result, WorkspaceIndexPublicationAttempt::Cancelled);
    assert!(!path.exists());
}

#[test]
fn writer_actor_recovers_expired_staging_files_once_per_workspace() {
    let root =
        std::env::temp_dir().join(format!("arkline-writer-recovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class Entry {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, std::slice::from_ref(&source_path), &[])
        .unwrap();
    let staging = root.join(".arkline").join("index").join("staging");
    fs::create_dir_all(&staging).unwrap();
    let first_orphan = staging.join("first-orphan.tmp");
    write_expired_file(&first_orphan);
    let actor = WorkspaceIndexWriterActor::new();

    let first_result = publish_content(&actor, &root_path, &source_path, 21);

    assert!(matches!(
        first_result,
        WorkspaceIndexPublicationAttempt::Applied(_)
    ));
    assert!(!first_orphan.exists());
    let first_metrics = actor.snapshot();
    assert_eq!(first_metrics.recovery_workspace_count, 1);
    assert_eq!(first_metrics.orphan_artifact_removed_count, 1);
    assert_eq!(first_metrics.recovery_failure_count, 0);

    let second_orphan = staging.join("second-orphan.json");
    write_expired_file(&second_orphan);
    let second_result = publish_content(&actor, &root_path, &source_path, 22);

    assert!(matches!(
        second_result,
        WorkspaceIndexPublicationAttempt::Applied(_)
    ));
    assert!(second_orphan.exists());
    let second_metrics = actor.snapshot();
    assert_eq!(second_metrics.recovery_workspace_count, 1);
    assert_eq!(second_metrics.orphan_artifact_removed_count, 1);
    fs::remove_dir_all(root).unwrap();
}

fn publish_content(
    actor: &WorkspaceIndexWriterActor,
    root_path: &str,
    source_path: &str,
    generation: u64,
) -> WorkspaceIndexPublicationAttempt {
    let artifact = WorkspaceIndexPublicationArtifact::Content {
        root_path: root_path.to_string(),
        prepared: prepare_workspace_content_refresh(
            root_path,
            &[source_path.to_string()],
            &[],
            generation,
        ),
    };
    let descriptor = write_workspace_publication_artifact(root_path, &artifact).unwrap();
    actor.publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.to_string(),
            descriptor,
            priority: PublicationPriority::Background,
        },
        || false,
    )
}

fn write_expired_file(path: &std::path::Path) {
    fs::write(path, "{}").unwrap();
    let expired_at = SystemTime::now()
        .checked_sub(Duration::from_secs(600))
        .unwrap();
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(FileTimes::new().set_modified(expired_at))
        .unwrap();
}
