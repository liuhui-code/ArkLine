use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageQueryRequest {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub content: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
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
