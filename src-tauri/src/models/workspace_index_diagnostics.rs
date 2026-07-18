use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexEvent {
    pub event_id: String,
    pub root_path: String,
    pub scope: String,
    pub kind: String,
    pub phase: String,
    pub severity: String,
    pub message: String,
    pub task_id: Option<String>,
    pub generation: Option<u64>,
    pub payload_json: String,
    pub created_at: u128,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexTimelineItem {
    pub scope: String,
    pub kind: String,
    pub phase: String,
    pub title: String,
    pub severity: String,
    pub message: String,
    pub task_id: Option<String>,
    pub generation: Option<u64>,
    pub occurred_at: u128,
    pub duration_ms: Option<u128>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexQueuePressure {
    pub root_path: String,
    pub pending_task_count: usize,
    pub workspace_pending_task_count: usize,
    pub highest_priority: Option<String>,
    pub highest_priority_task_kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexSchemaVersionAction {
    pub domain: String,
    pub expected_version: i64,
    pub persisted_version: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexFreshnessLayerSummary {
    pub layer: String,
    pub ready_count: i64,
    pub stale_count: i64,
    pub missing_count: i64,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexWriterMetrics {
    pub sample_count: u64,
    pub active_writer_count: usize,
    pub queued_writer_count: usize,
    pub failure_count: u64,
    pub wait_p50_us: u64,
    pub wait_p95_us: u64,
    pub wait_p99_us: u64,
    pub wait_max_us: u64,
    pub hold_p50_us: u64,
    pub hold_p95_us: u64,
    pub hold_p99_us: u64,
    pub hold_max_us: u64,
    pub last_wait_us: u64,
    pub last_hold_us: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexDiagnostics {
    pub root_path: String,
    pub status: String,
    pub schema_versions: std::collections::HashMap<String, i64>,
    pub schema_version_actions: Vec<WorkspaceIndexSchemaVersionAction>,
    pub freshness_layers: Vec<WorkspaceIndexFreshnessLayerSummary>,
    pub file_count: i64,
    pub symbol_count: i64,
    pub content_line_count: i64,
    pub fingerprint_count: i64,
    pub stub_file_count: i64,
    pub stub_declaration_count: i64,
    pub dependency_edge_count: i64,
    pub unresolved_import_count: i64,
    pub parser_error_count: i64,
    pub stale_generation_count: i64,
    pub sdk_symbol_count: i64,
    pub discovery_status: Option<String>,
    pub discovered_file_count: i64,
    pub discovery_excluded_count: i64,
    pub discovery_has_more: bool,
    pub db_size_bytes: u64,
    #[serde(default)]
    pub writer_metrics: WorkspaceIndexWriterMetrics,
    pub queue_pressure: WorkspaceIndexQueuePressure,
    pub active_sdk_path: Option<String>,
    pub active_sdk_version: Option<String>,
    pub last_error: Option<String>,
    pub last_explain_status: Option<String>,
    pub retry_backoff_count: i64,
    pub latest_retry_backoff: Option<String>,
    pub repair_actions: Vec<String>,
    pub parser_failures: Vec<WorkspaceIndexParserFailure>,
    pub unresolved_imports: Vec<WorkspaceIndexUnresolvedImport>,
    pub recent_events: Vec<WorkspaceIndexEvent>,
    pub timeline: Vec<WorkspaceIndexTimelineItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexer_host: Option<WorkspaceIndexerHostSnapshot>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexerHostSnapshot {
    pub enabled: bool,
    pub status: String,
    pub process_id: Option<u32>,
    #[serde(default)]
    pub discovery_process_id: Option<u32>,
    #[serde(default)]
    pub content_process_id: Option<u32>,
    #[serde(default)]
    pub stub_process_id: Option<u32>,
    #[serde(default)]
    pub discovery_writer_metrics: Option<WorkspaceIndexWriterMetrics>,
    #[serde(default)]
    pub content_writer_metrics: Option<WorkspaceIndexWriterMetrics>,
    #[serde(default)]
    pub stub_writer_metrics: Option<WorkspaceIndexWriterMetrics>,
    pub completed_discovery_chunks: u64,
    pub completed_content_refresh_chunks: u64,
    pub cancelled_content_refresh_chunks: u64,
    pub completed_stub_refresh_chunks: u64,
    pub cancelled_stub_refresh_chunks: u64,
    pub fallback_count: u64,
    #[serde(default)]
    pub restart_count: u64,
    #[serde(default)]
    pub consecutive_failure_count: u32,
    #[serde(default)]
    pub backoff_remaining_ms: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexParserFailure {
    pub path: String,
    pub message: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexUnresolvedImport {
    pub from_path: String,
    pub source_module: String,
    pub line: usize,
    pub column: usize,
}
