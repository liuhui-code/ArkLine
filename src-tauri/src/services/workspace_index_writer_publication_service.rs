use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;
use crate::services::workspace_content_refresh_chunk_service::{
    publish_prepared_workspace_content_core_chunk,
    publish_prepared_workspace_content_refresh_chunk,
    publish_prepared_workspace_content_substring_chunk,
};
use crate::services::workspace_discovery_runner_service::publish_prepared_workspace_discovery_chunk;
use crate::services::workspace_index_maintenance_publication_service::publish_workspace_index_maintenance;
use crate::services::workspace_index_publication_artifact_service::{
    read_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_sdk_index_service::publish_prepared_workspace_sdk_catalog_chunk;
use crate::services::workspace_stub_refresh_chunk_service::publish_prepared_workspace_stub_refresh_chunk;

use super::{WorkspaceIndexPublicationKind, WorkspaceIndexPublicationRequest};

pub(super) fn publish_artifact(
    request: &WorkspaceIndexPublicationRequest,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    match read_workspace_publication_artifact(&request.root_path, &request.descriptor)? {
        WorkspaceIndexPublicationArtifact::Discovery {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_discovery_chunk(&prepared)
        }
        WorkspaceIndexPublicationArtifact::Discovery { .. } => root_mismatch("Discovery"),
        WorkspaceIndexPublicationArtifact::SdkCatalog {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_sdk_catalog_chunk(&prepared)
        }
        WorkspaceIndexPublicationArtifact::SdkCatalog { .. } => root_mismatch("SDK"),
        WorkspaceIndexPublicationArtifact::Content {
            root_path,
            prepared,
        } if root_path == request.root_path => match request.kind {
            WorkspaceIndexPublicationKind::Default => {
                publish_prepared_workspace_content_refresh_chunk(&root_path, &prepared)
            }
            WorkspaceIndexPublicationKind::ContentCore => {
                publish_prepared_workspace_content_core_chunk(&root_path, &prepared)
            }
            WorkspaceIndexPublicationKind::ContentSubstring => {
                publish_prepared_workspace_content_substring_chunk(&root_path, &prepared)
            }
        },
        WorkspaceIndexPublicationArtifact::Content { .. } => root_mismatch("Content"),
        WorkspaceIndexPublicationArtifact::Stub {
            root_path,
            prepared,
        } if root_path == request.root_path => {
            publish_prepared_workspace_stub_refresh_chunk(&root_path, &prepared)
        }
        WorkspaceIndexPublicationArtifact::Stub { .. } => root_mismatch("Stub"),
        WorkspaceIndexPublicationArtifact::Maintenance {
            root_path,
            operation,
        } if root_path == request.root_path => {
            publish_workspace_index_maintenance(&root_path, operation)
        }
        WorkspaceIndexPublicationArtifact::Maintenance { .. } => root_mismatch("Maintenance"),
    }
}

fn root_mismatch(kind: &str) -> Result<WorkspaceIndexPublicationProfile, String> {
    Err(format!(
        "{kind} publication artifact root did not match the request"
    ))
}
