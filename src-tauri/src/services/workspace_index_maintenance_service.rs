use std::fs;
use std::path::Path;

use crate::services::workspace_index_cache_path_service::catalog_cache_path;
use crate::services::workspace_index_maintenance_publication_service::WorkspaceIndexMaintenanceOperation;
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_writer_actor_service::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest, WorkspaceIndexWriterActor,
};

pub fn clear_workspace_index(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Err(format!("Workspace root does not exist: {root_path}"));
    }
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.to_string(),
        operation: WorkspaceIndexMaintenanceOperation::ResetWorkspace,
    };
    let descriptor = write_workspace_publication_artifact(root_path, &artifact)?;
    let result = WorkspaceIndexWriterActor::shared().publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.to_string(),
            descriptor,
            priority: PublicationPriority::Maintenance,
        },
        || false,
    );
    match result {
        WorkspaceIndexPublicationAttempt::Applied(_) => {
            let legacy_cache = catalog_cache_path(root_path);
            if legacy_cache.exists() {
                fs::remove_file(legacy_cache).map_err(|error| error.to_string())?;
            }
            index_runtime.clear_workspace_index_state(root_path)
        }
        WorkspaceIndexPublicationAttempt::Cancelled => {
            Err("Workspace index maintenance was cancelled".to_string())
        }
        WorkspaceIndexPublicationAttempt::Failed(error) => Err(error),
    }
}
