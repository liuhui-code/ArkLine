use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::workspace_index_diagnostics::WorkspaceIndexWriterMetrics;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationArtifactDescriptor, WorkspaceIndexPublicationProfile,
};
use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursorIdentity;

pub const INDEXER_PROTOCOL_VERSION: u64 = 6;
pub const INDEXER_CONTENT_REFRESH_PATH_LIMIT: usize = 64;
pub const INDEXER_STUB_REFRESH_PATH_LIMIT: usize = 64;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerTaskKey {
    pub root_path: String,
    pub kind: String,
    pub generation: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerDiscoveryRequest {
    pub task: IndexerTaskKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_directories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_identity: Option<WorkspaceDiscoveryCursorIdentity>,
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerDiscoveryResult {
    pub task: IndexerTaskKey,
    pub chunk_file_count: usize,
    pub excluded_count: usize,
    pub has_more: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_directories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_artifact: Option<WorkspaceIndexPublicationArtifactDescriptor>,
    #[serde(default)]
    pub publication_profile: WorkspaceIndexPublicationProfile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerStubRefreshRequest {
    pub task: IndexerTaskKey,
    pub indexed_generation: u64,
    pub changed_paths: Vec<String>,
    pub removed_paths: Vec<String>,
    pub priority: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerStubRefreshResult {
    pub task: IndexerTaskKey,
    pub indexed_generation: u64,
    pub changed_path_count: usize,
    pub removed_path_count: usize,
    pub parsed_file_count: usize,
    pub parse_error_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_artifact: Option<WorkspaceIndexPublicationArtifactDescriptor>,
    #[serde(default)]
    pub publication_profile: WorkspaceIndexPublicationProfile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerContentRefreshRequest {
    pub task: IndexerTaskKey,
    pub indexed_generation: u64,
    pub changed_paths: Vec<String>,
    pub removed_paths: Vec<String>,
    pub priority: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerContentRefreshResult {
    pub task: IndexerTaskKey,
    pub indexed_generation: u64,
    pub changed_path_count: usize,
    pub removed_path_count: usize,
    pub indexed_file_count: usize,
    pub indexed_line_count: usize,
    pub unreadable_file_count: usize,
    pub resource_limited_file_count: usize,
    pub processed_source_bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_artifact: Option<WorkspaceIndexPublicationArtifactDescriptor>,
    #[serde(default)]
    pub publication_profile: WorkspaceIndexPublicationProfile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerRequest {
    pub id: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerResponse {
    pub id: String,
    pub ok: bool,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telemetry: Option<IndexerResponseTelemetry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexerResponseTelemetry {
    pub writer_metrics: WorkspaceIndexWriterMetrics,
}

impl IndexerResponse {
    pub fn health(id: String) -> Self {
        Self {
            id,
            ok: true,
            payload: serde_json::json!({
                "status": "ready",
                "protocolVersion": INDEXER_PROTOCOL_VERSION,
                "capabilities": ["health", "discoveryChunk", "discoveryPrepareChunk", "contentRefreshChunk", "contentPrepareChunk", "contentResourceBudget", "stubRefreshChunk", "stubPrepareChunk", "writerActorPublication", "writerTelemetry", "publicationStageTelemetry"],
            }),
            telemetry: None,
            error: None,
        }
    }

    pub fn unsupported(id: String, method: &str) -> Self {
        Self {
            id,
            ok: false,
            payload: Value::Null,
            telemetry: None,
            error: Some(format!("Unsupported indexer method: {method}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        IndexerContentRefreshResult, IndexerRequest, IndexerResponse, INDEXER_PROTOCOL_VERSION,
    };

    #[test]
    fn protocol_uses_versioned_camel_case_health_contract() {
        let request: IndexerRequest = serde_json::from_str(
            r#"{"id":"health-1","method":"health","payload":{"rootPath":"/workspace"}}"#,
        )
        .unwrap();
        let response = IndexerResponse::health(request.id);
        let json = serde_json::to_value(response).unwrap();

        assert_eq!(request.method, "health");
        assert_eq!(json["payload"]["protocolVersion"], INDEXER_PROTOCOL_VERSION);
        assert_eq!(json["payload"]["capabilities"][0], "health");
    }

    #[test]
    fn old_refresh_results_default_missing_publication_telemetry() {
        let result: IndexerContentRefreshResult = serde_json::from_value(serde_json::json!({
            "task": {
                "rootPath": "/workspace",
                "kind": "content-refresh",
                "generation": 1,
                "reason": "compatibility"
            },
            "indexedGeneration": 1,
            "changedPathCount": 1,
            "removedPathCount": 0,
            "indexedFileCount": 1,
            "indexedLineCount": 1,
            "unreadableFileCount": 0,
            "resourceLimitedFileCount": 0,
            "processedSourceBytes": 10
        }))
        .unwrap();

        assert_eq!(result.publication_profile.total_duration_us, 0);
        assert!(result.publication_profile.stages.is_empty());
    }
}
