use serde::{Deserialize, Serialize};
use std::fmt;

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
pub struct WorkspaceTextSearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextSearchRequest {
    pub root_path: String,
    pub query: String,
    pub options: WorkspaceTextSearchOptions,
    pub limit: usize,
    pub context_lines: usize,
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
}
