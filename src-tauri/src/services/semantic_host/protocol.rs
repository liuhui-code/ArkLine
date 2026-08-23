use serde::{Deserialize, Serialize};

use crate::models::language::{CodeActionResolveRequest, CompletionItem};

pub const SEMANTIC_PROTOCOL_VERSION: u64 = 6;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentSync {
    pub path: String,
    pub content: String,
    pub document_version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentPosition {
    pub path: String,
    pub line: u32,
    pub column: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticReplayDocument {
    pub path: String,
    pub content: String,
    pub content_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRequest {
    pub id: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<SemanticDocumentPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<CodeActionResolveRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion: Option<CompletionItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documents: Option<Vec<SemanticReplayDocument>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<SemanticDocumentSync>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_path: Option<String>,
}

impl SemanticRequest {
    #[allow(dead_code)]
    pub fn goto_definition(id: String, path: String, line: u32, column: u32) -> Self {
        Self {
            id,
            method: "gotoDefinition".to_string(),
            position: Some(SemanticDocumentPosition {
                path,
                line,
                column,
                content: None,
                content_generation: None,
                document_version: None,
            }),
            action: None,
            completion: None,
            new_name: None,
            documents: None,
            document: None,
            document_path: None,
        }
    }

    pub fn rename_symbol(
        id: String,
        path: String,
        line: u32,
        column: u32,
        new_name: String,
        document_version: Option<u64>,
    ) -> Self {
        Self {
            id,
            method: "rename".to_string(),
            position: Some(SemanticDocumentPosition {
                path,
                line,
                column,
                content: None,
                content_generation: None,
                document_version,
            }),
            action: None,
            completion: None,
            new_name: Some(new_name),
            documents: None,
            document: None,
            document_path: None,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDefinitionTarget {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SemanticResponsePayload {
    Definition(SemanticDefinitionTarget),
    #[serde(rename_all = "camelCase")]
    DefinitionResult {
        definition: Option<SemanticDefinitionTarget>,
        #[serde(default)]
        definition_candidates: Vec<SemanticDefinitionTarget>,
    },
    Completion(Vec<String>),
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticResponse {
    pub id: String,
    pub ok: bool,
    pub payload: SemanticResponsePayload,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        SemanticDefinitionTarget, SemanticRequest, SemanticResponse, SemanticResponsePayload,
    };

    #[test]
    fn semantic_host_protocol_serializes_definition_request_and_completion_response() {
        let definition = SemanticRequest::goto_definition(
            "req-1".to_string(),
            "/tmp/entry/src/main/ets/pages/Index.ets".to_string(),
            12,
            7,
        );

        let completion = SemanticResponse {
            id: "req-2".to_string(),
            ok: true,
            payload: SemanticResponsePayload::Completion(vec![
                "build".to_string(),
                "Button".to_string(),
            ]),
            error: None,
        };

        let definition_json = serde_json::to_string(&definition).unwrap();
        let completion_json = serde_json::to_string(&completion).unwrap();
        let candidates = SemanticResponse {
            id: "req-3".to_string(),
            ok: true,
            payload: SemanticResponsePayload::DefinitionResult {
                definition: Some(SemanticDefinitionTarget {
                    path: "/tmp/Shared.ets".to_string(),
                    line: 1,
                    column: 17,
                }),
                definition_candidates: vec![SemanticDefinitionTarget {
                    path: "/tmp/Shared.ets".to_string(),
                    line: 1,
                    column: 17,
                }],
            },
            error: None,
        };
        let candidates_json = serde_json::to_string(&candidates).unwrap();

        assert!(definition_json.contains("\"method\":\"gotoDefinition\""));
        assert!(completion_json.contains("\"completion\""));
        assert!(candidates_json.contains("\"definitionCandidates\""));
    }

    #[test]
    fn semantic_host_protocol_serializes_versioned_rename_request() {
        let rename = SemanticRequest::rename_symbol(
            "req-rename".to_string(),
            "/workspace/Model.ts".to_string(),
            4,
            9,
            "displayName".to_string(),
            Some(12),
        );

        let value = serde_json::to_value(rename).unwrap();

        assert_eq!(value["method"], "rename");
        assert_eq!(value["newName"], "displayName");
        assert_eq!(value["position"]["documentVersion"], 12);
    }
}
