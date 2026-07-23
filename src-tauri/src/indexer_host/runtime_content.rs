use crate::indexer_sidecar::{IndexerContentRefreshResult, IndexerTaskKey};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_writer_actor_service::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest,
};

use super::runtime::IndexerHostRuntime;
use super::runtime_state::IndexerRequestKind;
use super::session::{is_cancelled_error, is_stale_generation_error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexerContentRefreshAttempt {
    Applied(IndexerContentRefreshResult),
    Unavailable,
    Cancelled,
}

impl IndexerHostRuntime {
    pub fn refresh_content_chunk<F>(
        &self,
        task: IndexerTaskKey,
        indexed_generation: u64,
        changed_paths: Vec<String>,
        removed_paths: Vec<String>,
        is_cancelled: F,
    ) -> IndexerContentRefreshAttempt
    where
        F: FnMut() -> bool,
    {
        self.refresh_content_chunk_with_priority(
            task,
            indexed_generation,
            changed_paths,
            removed_paths,
            PublicationPriority::Background,
            is_cancelled,
        )
    }

    pub(crate) fn refresh_content_chunk_with_priority<F>(
        &self,
        task: IndexerTaskKey,
        indexed_generation: u64,
        changed_paths: Vec<String>,
        removed_paths: Vec<String>,
        priority: PublicationPriority,
        mut is_cancelled: F,
    ) -> IndexerContentRefreshAttempt
    where
        F: FnMut() -> bool,
    {
        if !self.enabled {
            return IndexerContentRefreshAttempt::Unavailable;
        }
        let mut session = match self.checkout_session(IndexerRequestKind::ContentRefresh) {
            Ok(Some(session)) => session,
            Ok(None) => return IndexerContentRefreshAttempt::Unavailable,
            Err(error) => {
                self.finish_failure(IndexerRequestKind::ContentRefresh, error);
                return IndexerContentRefreshAttempt::Unavailable;
            }
        };
        let result = session.refresh_content_chunk(
            task,
            indexed_generation,
            changed_paths,
            removed_paths,
            || is_cancelled(),
        );
        match result {
            Ok(mut result) => {
                let Some(descriptor) = result.publication_artifact.take() else {
                    if !session.supports_writer_actor_publication() {
                        self.finish_success(session, IndexerRequestKind::ContentRefresh);
                        return IndexerContentRefreshAttempt::Applied(result);
                    }
                    self.finish_failure(
                        IndexerRequestKind::ContentRefresh,
                        "Indexer content prepare omitted publication artifact".to_string(),
                    );
                    return IndexerContentRefreshAttempt::Unavailable;
                };
                match self.writer.publish(
                    WorkspaceIndexPublicationRequest {
                        root_path: result.task.root_path.clone(),
                        descriptor,
                        priority,
                    },
                    || is_cancelled(),
                ) {
                    WorkspaceIndexPublicationAttempt::Applied(profile) => {
                        result.publication_profile = profile;
                        session.record_publication_profile(&result.publication_profile);
                        self.finish_success(session, IndexerRequestKind::ContentRefresh);
                        IndexerContentRefreshAttempt::Applied(result)
                    }
                    WorkspaceIndexPublicationAttempt::Cancelled => {
                        self.finish_cancelled(IndexerRequestKind::ContentRefresh);
                        IndexerContentRefreshAttempt::Cancelled
                    }
                    WorkspaceIndexPublicationAttempt::Failed(error)
                        if is_stale_generation_error(&error) =>
                    {
                        self.finish_superseded(session, IndexerRequestKind::ContentRefresh);
                        IndexerContentRefreshAttempt::Cancelled
                    }
                    WorkspaceIndexPublicationAttempt::Failed(error) => {
                        self.finish_failure(IndexerRequestKind::ContentRefresh, error);
                        IndexerContentRefreshAttempt::Unavailable
                    }
                }
            }
            Err(error) if is_cancelled_error(&error) => {
                self.finish_cancelled(IndexerRequestKind::ContentRefresh);
                IndexerContentRefreshAttempt::Cancelled
            }
            Err(error) if is_stale_generation_error(&error) => {
                self.finish_superseded(session, IndexerRequestKind::ContentRefresh);
                IndexerContentRefreshAttempt::Cancelled
            }
            Err(error) => {
                self.finish_failure(IndexerRequestKind::ContentRefresh, error);
                IndexerContentRefreshAttempt::Unavailable
            }
        }
    }
}
