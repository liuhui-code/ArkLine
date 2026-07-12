use serde::{Deserialize, Serialize};
use std::fmt;

pub use crate::models::workspace_index_diagnostics::{
    WorkspaceIndexDiagnostics, WorkspaceIndexEvent, WorkspaceIndexParserFailure,
    WorkspaceIndexQueuePressure, WorkspaceIndexSchemaVersionAction, WorkspaceIndexTimelineItem,
    WorkspaceIndexUnresolvedImport,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root_name: String,
    pub root_path: String,
    pub files: Vec<String>,
    pub scan_summary: WorkspaceScanSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScanSummary {
    pub scanned_files: usize,
    pub skipped_entries: usize,
    pub truncated: bool,
    pub exclude_rules: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: WorkspaceDirectoryEntryKind,
    pub excluded: bool,
    pub has_children: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceDirectoryEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceIndexStatus {
    Empty,
    Scanning,
    Ready,
    Partial,
    Stale,
    Failed,
}

impl fmt::Display for WorkspaceIndexStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            WorkspaceIndexStatus::Empty => "empty",
            WorkspaceIndexStatus::Scanning => "scanning",
            WorkspaceIndexStatus::Ready => "ready",
            WorkspaceIndexStatus::Partial => "partial",
            WorkspaceIndexStatus::Stale => "stale",
            WorkspaceIndexStatus::Failed => "failed",
        };
        formatter.write_str(value)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexState {
    pub status: WorkspaceIndexStatus,
    pub root_path: Option<String>,
    pub file_paths: Vec<String>,
    #[serde(default)]
    pub symbols: Vec<WorkspaceIndexedSymbol>,
    pub indexed_at: Option<u128>,
    pub partial_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexedSymbol {
    pub source: String,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub line: usize,
    pub column: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct ArkTsFileStub {
    pub path: String,
    pub module_name: Option<String>,
    pub imports: Vec<ArkTsImportStub>,
    pub exports: Vec<ArkTsExportStub>,
    pub declarations: Vec<ArkTsDeclarationStub>,
    pub parse_errors: Vec<ArkTsParseError>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct ArkTsImportStub {
    pub source_module: String,
    pub imported_name: Option<String>,
    pub local_name: String,
    pub is_type_only: bool,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct ArkTsExportStub {
    pub exported_name: String,
    pub local_name: Option<String>,
    pub source_module: Option<String>,
    pub is_default: bool,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct ArkTsDeclarationStub {
    pub kind: String,
    pub name: String,
    pub qualified_name: String,
    pub container: Option<String>,
    pub visibility: Option<String>,
    pub modifiers: Vec<String>,
    pub decorators: Vec<String>,
    pub signature: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct ArkTsParseError {
    pub message: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchCandidate {
    pub id: String,
    pub source: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    pub score: f64,
    pub freshness: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceIndexReadinessState {
    Ready,
    Partial,
    Stale,
    Blocked,
    Missing,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexReadiness {
    pub root_path: String,
    pub requested_generation: u64,
    pub served_generation: Option<u64>,
    pub state: WorkspaceIndexReadinessState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexQueryEnvelope<T> {
    pub items: Vec<T>,
    pub readiness: WorkspaceIndexReadiness,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub explain: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexExplainRequest {
    pub root_path: String,
    pub kind: String,
    pub query: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexExplainFact {
    pub category: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexExplainResult {
    pub status: String,
    pub message: String,
    pub facts: Vec<WorkspaceIndexExplainFact>,
    pub recommended_action: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexRefreshResult {
    pub state: WorkspaceIndexState,
    pub changed: bool,
    pub added_paths: Vec<String>,
    pub removed_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexTaskStatus {
    pub task_id: String,
    pub root_path: String,
    pub kind: String,
    pub status: String,
    pub reason: String,
    pub generation: u64,
    pub progress_current: usize,
    pub progress_total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_at: Option<u128>,
    pub stalled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexHealth {
    pub root_path: String,
    pub status: String,
    pub file_count: i64,
    pub symbol_count: i64,
    pub reference_count: i64,
    pub sdk_api_count: i64,
    pub discovery_status: Option<String>,
    pub discovered_file_count: i64,
    pub unresolved_import_count: i64,
    pub parser_failure_count: i64,
    pub queue_pressure: WorkspaceIndexQueuePressure,
    pub repair_actions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexFileReadiness {
    pub root_path: String,
    pub path: String,
    pub file_name: String,
    pub discovery_index: String,
    pub file_index: String,
    pub content_index: String,
    pub symbol_index: String,
    pub parser_status: String,
    pub parser_error: Option<String>,
    pub indexed_generation: Option<u64>,
    pub definition_available: bool,
    pub completion_available: bool,
    pub usages_available: bool,
    pub search_available: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexSdkRepairTarget {
    pub sdk_path: String,
    pub sdk_version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchRequest {
    pub root_path: String,
    pub query: String,
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub cursor: Option<WorkspaceTextSearchCursor>,
    pub options: WorkspaceTextSearchOptions,
    pub limit: usize,
    pub context_lines: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchCursor {
    pub path_index: usize,
    pub line_index: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkspaceTextSearchQuery {
    Text { query: String },
    Regex { query: String },
    Invalid { query: String, message: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchContextLine {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchMatch {
    pub path: String,
    pub relative_path: String,
    pub file_name: String,
    pub line: usize,
    pub column: usize,
    pub summary: String,
    pub preview: String,
    pub preview_start: usize,
    pub preview_end: usize,
    pub context_before: Vec<WorkspaceTextSearchContextLine>,
    pub context_after: Vec<WorkspaceTextSearchContextLine>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchResult {
    pub query: WorkspaceTextSearchQuery,
    pub matches: Vec<WorkspaceTextSearchMatch>,
    #[serde(default)]
    pub partial: bool,
    #[serde(default)]
    pub searched_files: usize,
    #[serde(default)]
    pub limit_reached: bool,
    #[serde(default)]
    pub next_cursor: Option<WorkspaceTextSearchCursor>,
}
