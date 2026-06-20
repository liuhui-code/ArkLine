use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceReport {
    pub provider: String,
    pub running: bool,
    pub hover: bool,
    pub definition: bool,
    pub completion: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageQueryRequest {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HoverResponse {
    pub contents: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionTarget {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub detail: String,
    pub kind: String,
}
