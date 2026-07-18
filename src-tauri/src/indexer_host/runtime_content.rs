use crate::indexer_sidecar::{IndexerContentRefreshResult, IndexerTaskKey};

use super::runtime::IndexerHostRuntime;
use super::runtime_state::IndexerRequestKind;
use super::session::is_cancelled_error;

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
            is_cancelled,
        );
        match result {
            Ok(result) => {
                self.finish_success(session, IndexerRequestKind::ContentRefresh);
                IndexerContentRefreshAttempt::Applied(result)
            }
            Err(error) if is_cancelled_error(&error) => {
                self.finish_cancelled(IndexerRequestKind::ContentRefresh);
                IndexerContentRefreshAttempt::Cancelled
            }
            Err(error) => {
                self.finish_failure(IndexerRequestKind::ContentRefresh, error);
                IndexerContentRefreshAttempt::Unavailable
            }
        }
    }
}
