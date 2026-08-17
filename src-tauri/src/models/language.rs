use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::workspace::{WorkspaceIndexQueryCapability, WorkspaceIndexReadiness};
use crate::models::workspace_edit::WorkspaceEditPlan;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceReport {
    pub provider: String,
    pub mode: String,
    pub running: bool,
    pub hover: bool,
    pub definition: bool,
    pub completion: bool,
    pub document_symbols: bool,
    pub find_usages: bool,
    pub capabilities: Vec<String>,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervisor: Option<SemanticSupervisorSnapshot>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkerRuntime {
    pub rss_bytes: u64,
    pub heap_used_bytes: u64,
    pub heap_total_bytes: u64,
    pub external_bytes: u64,
    pub uptime_ms: u64,
    #[serde(default)]
    pub provider_latencies: BTreeMap<String, SemanticProviderLatency>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticProviderLatency {
    pub count: u64,
    pub p50_us: u64,
    pub p95_us: u64,
    pub max_us: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSupervisorSnapshot {
    pub status: String,
    pub restart_count: u64,
    pub restored_document_count: u64,
    pub consecutive_failures: u32,
    pub last_heartbeat_epoch_ms: Option<u64>,
    pub retry_after_ms: u64,
    pub last_error: Option<String>,
    pub runtime: Option<SemanticWorkerRuntime>,
    pub memory_budget_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_actor: Option<SemanticRequestActorSnapshot>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRequestActorSnapshot {
    pub running: bool,
    pub queued: usize,
    pub completed: u64,
    pub superseded: u64,
    pub failed: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageQueryRequest {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageQueryBrokerEnvelope<T> {
    pub contract_version: u16,
    pub capability: WorkspaceIndexQueryCapability,
    pub items: Vec<T>,
    pub readiness: WorkspaceIndexReadiness,
    pub request_generation: u64,
    pub document_generation: Option<u64>,
    pub target_generation: Option<u64>,
    pub provider: String,
    pub confidence: String,
    pub fallback_used: bool,
    pub miss_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub explain: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentSyncRequest {
    pub method: String,
    pub path: String,
    pub content: String,
    pub document_version: u64,
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentCloseRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentPrepareRequest {
    pub path: String,
    pub document_version: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HoverResponse {
    pub contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionTarget {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionCandidate {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub detail: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_range: Option<TextRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commit_characters: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_target: Option<DefinitionTarget>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_text_edits: Vec<CompletionTextEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionTextEdit {
    pub path: String,
    pub range: TextRange,
    pub new_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelpParameter {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelpSignature {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    #[serde(default)]
    pub parameters: Vec<SignatureHelpParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelp {
    pub signatures: Vec<SignatureHelpSignature>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSymbol {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub kind: String,
    pub confidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caller: Option<UsageCaller>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCaller {
    pub symbol_id: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameImpactItem {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub name: String,
    pub kind: String,
    pub confidence: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameImpactResult {
    pub symbol_id: String,
    pub current_name: String,
    pub declaration: Option<RenameImpactItem>,
    pub references: Vec<RenameImpactItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SymbolHierarchyNode {
    pub symbol_id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallHierarchyEdge {
    pub symbol_id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallHierarchyResult {
    pub target: SymbolHierarchyNode,
    pub incoming: Vec<CallHierarchyEdge>,
    pub outgoing: Vec<CallHierarchyEdge>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypeHierarchyResult {
    pub target: SymbolHierarchyNode,
    pub supertypes: Vec<SymbolHierarchyNode>,
    pub subtypes: Vec<SymbolHierarchyNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeAction {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub provider: String,
    pub safety: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionResolveRequest {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedCodeActionResolution {
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CodeActionResolution {
    WorkspaceEdit(WorkspaceEditPlan),
    Unsupported(UnsupportedCodeActionResolution),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitTraceUnavailable {
    pub kind: String,
    pub reason: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub line: usize,
    pub commit: String,
    pub source_line: usize,
    pub author: String,
    pub authored_at: String,
    pub relative_time: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitTrace {
    pub commit: String,
    pub short_commit: String,
    pub author: String,
    pub email: Option<String>,
    pub authored_at: String,
    pub subject: String,
    pub relative_path: String,
    pub selected_line: usize,
    pub source_line: usize,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum GitBlameResponse {
    Lines(Vec<GitBlameLine>),
    Unavailable(GitTraceUnavailable),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum GitCommitTraceResponse {
    Trace(GitCommitTrace),
    Unavailable(GitTraceUnavailable),
}
