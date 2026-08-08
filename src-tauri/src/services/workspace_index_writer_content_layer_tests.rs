use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use super::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationKind,
    WorkspaceIndexPublicationRequest, WorkspaceIndexWriterActor,
};
use crate::services::workspace_content_refresh_service::prepare_workspace_content_refresh;
use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

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
        WorkspaceIndexPublicationRequest::new(
            root_path.clone(),
            descriptor,
            PublicationPriority::Background,
        ),
        || false,
    );

    assert!(matches!(
        result,
        WorkspaceIndexPublicationAttempt::Applied(_)
    ));
    let connection = open_existing_workspace_index_reader(&root_path)
        .unwrap()
        .unwrap();
    let count: i64 = connection
        .query_row("select count(*) from workspace_content_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    let metrics = actor.snapshot();
    assert_eq!(metrics.sample_count, 1);
    assert_eq!(metrics.active_writer_count, 0);
    assert_eq!(metrics.queued_writer_count, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn content_core_returns_before_detached_substring_publication() {
    let root = std::env::temp_dir().join(format!(
        "arkline-writer-content-layers-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("Entry.ets");
    fs::write(&source, "class SearchableEntry {}\n").unwrap();
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
    let substring_descriptor = descriptor.clone();
    let actor = WorkspaceIndexWriterActor::new();

    let core = actor.publish(
        WorkspaceIndexPublicationRequest::content(
            root_path.clone(),
            descriptor,
            PublicationPriority::Background,
            WorkspaceIndexPublicationKind::ContentCore,
        ),
        || false,
    );

    let WorkspaceIndexPublicationAttempt::Applied(profile) = core else {
        panic!("content core publication should succeed");
    };
    assert!(profile.stages.iter().all(|stage| {
        stage.name.starts_with("contentCore") || stage.name == "contentSubstringInvalidate"
    }));
    assert!(std::path::Path::new(&substring_descriptor.path).exists());
    actor
        .publish_detached(WorkspaceIndexPublicationRequest::content(
            root_path.clone(),
            substring_descriptor.clone(),
            PublicationPriority::IdleMaintenance,
            WorkspaceIndexPublicationKind::ContentSubstring,
        ))
        .unwrap();
    wait_for_substring(&actor, &root_path, &substring_descriptor.path);
    fs::remove_dir_all(root).unwrap();
}

fn wait_for_substring(actor: &WorkspaceIndexWriterActor, root_path: &str, artifact_path: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let connection = open_existing_workspace_index_reader(root_path)
            .unwrap()
            .unwrap();
        let count: i64 = connection
            .query_row(
                "select count(*) from workspace_content_trigram_fts",
                [],
                |row| row.get(0),
            )
            .unwrap();
        if count == 1 && !std::path::Path::new(artifact_path).exists() {
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    let metrics = actor.snapshot();
    assert_eq!(metrics.content_core_publication_count, 1);
    assert_eq!(metrics.content_substring_publication_count, 1);
    assert!(metrics.content_core_publication_max_us > 0);
    assert!(metrics.content_substring_publication_max_us > 0);
}
