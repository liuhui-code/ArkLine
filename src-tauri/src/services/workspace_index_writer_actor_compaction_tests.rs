use std::fs;

use super::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest, WorkspaceIndexWriterActor,
};
use crate::services::workspace_index_compaction_service::prepare_workspace_index_compaction;
use crate::services::workspace_index_connection_service::{
    quiesce_workspace_index_store_for_compaction, with_workspace_index_writer,
};
use crate::services::workspace_index_maintenance_publication_service::WorkspaceIndexMaintenanceOperation;
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

#[test]
fn writer_actor_commits_a_copy_swap_candidate_and_records_metrics() {
    let root =
        std::env::temp_dir().join(format!("arkline-writer-copy-swap-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    with_workspace_index_writer(&root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        connection
            .execute_batch(
                "create table copy_swap_sample(value text not null);
                 insert into copy_swap_sample values('keep');",
            )
            .map_err(|error| error.to_string())
    })
    .unwrap();
    assert!(quiesce_workspace_index_store_for_compaction(&root_path).unwrap());
    let candidate = prepare_workspace_index_compaction(&root_path, || false)
        .unwrap()
        .unwrap();
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.clone(),
        operation: WorkspaceIndexMaintenanceOperation::CompactStore {
            candidate: candidate.clone(),
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

    let WorkspaceIndexPublicationAttempt::Applied(profile) = &result else {
        panic!("copy-swap publication should apply: {result:?}");
    };
    assert!(profile
        .stages
        .iter()
        .any(|stage| stage.name == "maintenanceCopySwapCommit"));
    assert!(!std::path::Path::new(&candidate.path).exists());
    let metrics = actor.snapshot();
    assert_eq!(metrics.maintenance_copy_swap_count, 1);
    assert_eq!(metrics.maintenance_copy_swap_deferred_count, 0);
    fs::remove_dir_all(root).unwrap();
}
