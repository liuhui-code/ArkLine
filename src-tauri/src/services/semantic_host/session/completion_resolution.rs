use super::super::protocol::{SemanticDocumentPosition, SemanticRequest};
use super::{extract_payload, parse_completion_item, SemanticWorkerSession};
use crate::models::language::{CompletionItem, CompletionTextEdit, LanguageQueryRequest};
use serde_json::Value;

pub(super) fn parse_completion_text_edits(item: &Value) -> Vec<CompletionTextEdit> {
    item.get("additionalTextEdits")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

impl SemanticWorkerSession {
    pub fn resolve_completion(
        &self,
        request: &LanguageQueryRequest,
        item: &CompletionItem,
        document_version: Option<u64>,
    ) -> Result<CompletionItem, String> {
        let request_id = self.next_request_id();
        let content_generation = self
            .document_generations
            .lock()
            .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
            .generation_for(&request.path, request.content.as_deref());
        let payload = SemanticRequest {
            id: request_id,
            method: "resolveCompletion".to_string(),
            position: Some(SemanticDocumentPosition {
                path: request.path.clone(),
                line: request.line,
                column: request.column,
                content: request.content.clone(),
                content_generation,
                document_version,
            }),
            action: None,
            completion: Some(item.clone()),
            documents: None,
            document: None,
            document_path: None,
        };
        let response = self.send_payload(payload, content_generation)?;
        parse_completion_item(extract_payload(&response.payload, "completion"))
            .ok_or_else(|| "Semantic worker completion resolution was invalid".to_string())
    }
}
