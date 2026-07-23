use crate::indexer_sidecar::{IndexerDiscoveryResult, IndexerTaskKey};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_writer_actor_service::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest,
};

use super::runtime::IndexerHostRuntime;
use super::runtime_state::IndexerRequestKind;
use super::session::is_stale_generation_error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexerDiscoveryAttempt {
    Applied(IndexerDiscoveryResult),
    Unavailable,
    Cancelled,
}

impl IndexerHostRuntime {
    pub fn discover_workspace_chunk(
        &self,
        task: IndexerTaskKey,
        pending_directories: Option<Vec<String>>,
        limit: usize,
    ) -> IndexerDiscoveryAttempt {
        if !self.enabled {
            return IndexerDiscoveryAttempt::Unavailable;
        }
        let mut session = match self.checkout_session(IndexerRequestKind::Discovery) {
            Ok(Some(session)) => session,
            Ok(None) => return IndexerDiscoveryAttempt::Unavailable,
            Err(error) => {
                self.finish_failure(IndexerRequestKind::Discovery, error);
                return IndexerDiscoveryAttempt::Unavailable;
            }
        };
        let actor_publication = session.supports_discovery_writer_actor_publication();
        let result = if actor_publication {
            session.prepare_discovery_chunk(task, pending_directories, limit)
        } else {
            session.discover_workspace_chunk(task, pending_directories, limit)
        };
        match result {
            Ok(mut result) if actor_publication => {
                let Some(descriptor) = result.publication_artifact.take() else {
                    self.finish_failure(
                        IndexerRequestKind::Discovery,
                        "Indexer discovery prepare omitted publication artifact".to_string(),
                    );
                    return IndexerDiscoveryAttempt::Unavailable;
                };
                match self.writer.publish(
                    WorkspaceIndexPublicationRequest {
                        root_path: result.task.root_path.clone(),
                        descriptor,
                        priority: PublicationPriority::Background,
                    },
                    || false,
                ) {
                    WorkspaceIndexPublicationAttempt::Applied(profile) => {
                        result.publication_profile = profile;
                        session.record_publication_profile(&result.publication_profile);
                        self.finish_success(session, IndexerRequestKind::Discovery);
                        IndexerDiscoveryAttempt::Applied(result)
                    }
                    WorkspaceIndexPublicationAttempt::Cancelled => {
                        self.finish_cancelled(IndexerRequestKind::Discovery);
                        IndexerDiscoveryAttempt::Cancelled
                    }
                    WorkspaceIndexPublicationAttempt::Failed(error)
                        if is_stale_generation_error(&error) =>
                    {
                        self.finish_superseded(session, IndexerRequestKind::Discovery);
                        IndexerDiscoveryAttempt::Cancelled
                    }
                    WorkspaceIndexPublicationAttempt::Failed(error) => {
                        self.finish_failure(IndexerRequestKind::Discovery, error);
                        IndexerDiscoveryAttempt::Unavailable
                    }
                }
            }
            Ok(result) => {
                self.finish_success(session, IndexerRequestKind::Discovery);
                IndexerDiscoveryAttempt::Applied(result)
            }
            Err(error) if is_stale_generation_error(&error) => {
                self.finish_superseded(session, IndexerRequestKind::Discovery);
                IndexerDiscoveryAttempt::Cancelled
            }
            Err(error) => {
                self.finish_failure(IndexerRequestKind::Discovery, error);
                IndexerDiscoveryAttempt::Unavailable
            }
        }
    }
}
