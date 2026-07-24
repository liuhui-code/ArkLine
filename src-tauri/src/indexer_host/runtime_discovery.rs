use crate::indexer_sidecar::{IndexerDiscoveryResult, IndexerTaskKey};
use crate::models::workspace_index_publication::WorkspaceIndexPublicationArtifactDescriptor;
use crate::services::workspace_index_publication_artifact_service::{
    read_workspace_publication_artifact, remove_workspace_publication_artifact,
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_writer_actor_service::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest,
};

use super::runtime::IndexerHostRuntime;
use super::runtime_state::IndexerRequestKind;
use super::session::is_stale_generation_error;

const DISCOVERY_CURSOR_REQUEST_BUDGET_BYTES: usize = 256 * 1024;

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
        let (request_cursor, deferred_cursor) = if actor_publication {
            partition_discovery_cursor(pending_directories)
        } else {
            (pending_directories, Vec::new())
        };
        let result = if actor_publication {
            session.prepare_discovery_chunk(task, request_cursor, limit)
        } else {
            session.discover_workspace_chunk(task, request_cursor, limit)
        };
        match result {
            Ok(mut result) if actor_publication => {
                let Some(mut descriptor) = result.publication_artifact.take() else {
                    self.finish_failure(
                        IndexerRequestKind::Discovery,
                        "Indexer discovery prepare omitted publication artifact".to_string(),
                    );
                    return IndexerDiscoveryAttempt::Unavailable;
                };
                if !deferred_cursor.is_empty() {
                    descriptor = match extend_discovery_artifact_cursor(
                        &result.task.root_path,
                        &descriptor,
                        &deferred_cursor,
                    ) {
                        Ok(descriptor) => descriptor,
                        Err(error) => {
                            self.finish_failure(IndexerRequestKind::Discovery, error);
                            return IndexerDiscoveryAttempt::Unavailable;
                        }
                    };
                    merge_deferred_discovery_cursor(&mut result, deferred_cursor);
                }
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
            Ok(mut result) => {
                merge_deferred_discovery_cursor(&mut result, deferred_cursor);
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

fn partition_discovery_cursor(pending: Option<Vec<String>>) -> (Option<Vec<String>>, Vec<String>) {
    let Some(paths) = pending else {
        return (None, Vec::new());
    };
    let mut request = Vec::new();
    let mut deferred = Vec::new();
    let mut estimated_bytes = 0usize;
    for path in paths {
        let path_bytes = path.len().saturating_mul(2).saturating_add(4);
        if !request.is_empty()
            && estimated_bytes.saturating_add(path_bytes) > DISCOVERY_CURSOR_REQUEST_BUDGET_BYTES
        {
            deferred.push(path);
        } else {
            estimated_bytes = estimated_bytes.saturating_add(path_bytes);
            request.push(path);
        }
    }
    (Some(request), deferred)
}

fn merge_deferred_discovery_cursor(result: &mut IndexerDiscoveryResult, deferred: Vec<String>) {
    if deferred.is_empty() {
        return;
    }
    let mut pending = result.pending_directories.take().unwrap_or_default();
    pending.extend(deferred);
    result.pending_directories = Some(pending);
    result.has_more = true;
}

fn extend_discovery_artifact_cursor(
    root_path: &str,
    descriptor: &WorkspaceIndexPublicationArtifactDescriptor,
    deferred: &[String],
) -> Result<WorkspaceIndexPublicationArtifactDescriptor, String> {
    let mut artifact = read_workspace_publication_artifact(root_path, descriptor)?;
    let WorkspaceIndexPublicationArtifact::Discovery { prepared, .. } = &mut artifact else {
        return Err("Indexer discovery returned a non-discovery artifact".to_string());
    };
    let mut pending = prepared
        .chunk
        .cursor
        .take()
        .map(|cursor| cursor.pending_directories)
        .unwrap_or_default();
    pending.extend(deferred.iter().cloned());
    prepared.chunk.cursor = Some(
        crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor {
            pending_directories: pending,
        },
    );
    prepared.chunk.has_more = true;
    let replacement = write_workspace_publication_artifact(root_path, &artifact)?;
    remove_workspace_publication_artifact(descriptor);
    Ok(replacement)
}

#[cfg(test)]
mod tests {
    use super::{
        merge_deferred_discovery_cursor, partition_discovery_cursor,
        DISCOVERY_CURSOR_REQUEST_BUDGET_BYTES,
    };
    use crate::indexer_sidecar::{IndexerDiscoveryResult, IndexerTaskKey};
    use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;

    #[test]
    fn large_discovery_cursor_is_partitioned_and_rejoined_in_order() {
        let paths = (0..20_000)
            .map(|index| format!(r"C:\workspace\module\src\Page{index:06}.ets"))
            .collect::<Vec<_>>();
        let (request, deferred) = partition_discovery_cursor(Some(paths.clone()));
        let request = request.unwrap();
        assert!(!request.is_empty());
        assert!(!deferred.is_empty());
        let estimated = request.iter().map(|path| path.len() * 2 + 4).sum::<usize>();
        assert!(estimated <= DISCOVERY_CURSOR_REQUEST_BUDGET_BYTES);

        let mut result = discovery_result(vec!["sidecar-pending".to_string()]);
        merge_deferred_discovery_cursor(&mut result, deferred.clone());
        assert!(result.has_more);
        assert_eq!(
            result.pending_directories.as_ref().unwrap()[0],
            "sidecar-pending"
        );
        assert_eq!(
            &result.pending_directories.as_ref().unwrap()[1..],
            deferred.as_slice()
        );
        assert_eq!(request.len() + deferred.len(), paths.len());
    }

    fn discovery_result(pending: Vec<String>) -> IndexerDiscoveryResult {
        IndexerDiscoveryResult {
            task: IndexerTaskKey {
                root_path: "C:\\workspace".to_string(),
                kind: "discovery".to_string(),
                generation: 1,
                reason: "test".to_string(),
            },
            chunk_file_count: 0,
            excluded_count: 0,
            has_more: false,
            pending_directories: Some(pending),
            publication_artifact: None,
            publication_profile: WorkspaceIndexPublicationProfile::default(),
        }
    }
}
