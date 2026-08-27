use std::sync::atomic::Ordering;
use std::time::Duration;

use super::{RawSemanticResponse, SemanticWorkerSession, SEMANTIC_WORKER_REQUEST_TIMEOUT};
use crate::models::language::{CodeActionResolveRequest, LanguageQueryRequest};
use crate::services::semantic_host::protocol::{SemanticDocumentPosition, SemanticRequest};
use crate::services::semantic_host::response_state::{
    publish_response_readiness, validate_response_generation,
};

impl SemanticWorkerSession {
    pub(super) fn send_request(
        &self,
        method: &str,
        request: Option<&LanguageQueryRequest>,
    ) -> Result<RawSemanticResponse, String> {
        self.send_request_parts(method, request, None, None, SEMANTIC_WORKER_REQUEST_TIMEOUT)
    }

    pub(super) fn send_request_with_document_version(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
    ) -> Result<RawSemanticResponse, String> {
        self.send_request_parts(
            "completion",
            Some(request),
            None,
            document_version,
            SEMANTIC_WORKER_REQUEST_TIMEOUT,
        )
    }

    pub(super) fn send_action_request(
        &self,
        method: &str,
        action: &CodeActionResolveRequest,
    ) -> Result<RawSemanticResponse, String> {
        self.send_request_parts(
            method,
            None,
            Some(action),
            None,
            SEMANTIC_WORKER_REQUEST_TIMEOUT,
        )
    }

    pub(super) fn send_request_parts(
        &self,
        method: &str,
        request: Option<&LanguageQueryRequest>,
        action: Option<&CodeActionResolveRequest>,
        document_version: Option<u64>,
        timeout: Duration,
    ) -> Result<RawSemanticResponse, String> {
        let request_id = self.next_request_id();
        let content_generation = if let Some(value) = request {
            self.document_generations
                .lock()
                .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
                .generation_for(&value.path, value.content.as_deref())
        } else {
            None
        };
        let payload = SemanticRequest {
            id: request_id.clone(),
            method: method.to_string(),
            position: request.map(|value| SemanticDocumentPosition {
                path: value.path.clone(),
                line: value.line,
                column: value.column,
                content: value.content.clone(),
                content_generation,
                document_version,
            }),
            action: action.cloned(),
            completion: None,
            new_name: None,
            documents: None,
            document: None,
            document_path: None,
        };
        let expected_response_generation = matches!(
            method,
            "completion"
                | "gotoDefinition"
                | "findUsages"
                | "diagnostics"
                | "signatureHelp"
                | "prepareDocument"
                | "rename"
        )
        .then_some(content_generation)
        .flatten();
        self.send_payload(payload, expected_response_generation, timeout)
    }

    pub(super) fn next_request_id(&self) -> String {
        format!(
            "semantic-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    pub(super) fn send_payload(
        &self,
        payload: SemanticRequest,
        expected_response_generation: Option<u64>,
        timeout: Duration,
    ) -> Result<RawSemanticResponse, String> {
        let request_id = payload.id.clone();
        let method = payload.method.clone();
        let serialized = serde_json::to_string(&payload).map_err(|error| {
            format!("Failed to serialize semantic worker request {request_id}: {error}")
        })?;
        let line = self.actor.exchange(
            request_id.clone(),
            method.clone(),
            serialized,
            expected_response_generation,
            timeout,
        )?;

        if line.trim().is_empty() {
            return Err(format!(
                "Semantic worker returned an empty response for {request_id}"
            ));
        }

        let response: RawSemanticResponse = serde_json::from_str(line.trim()).map_err(|error| {
            format!("Failed to parse semantic worker response {request_id}: {error}")
        })?;
        if let Some(runtime) = response.runtime.clone() {
            if let Ok(mut latest) = self.latest_runtime.lock() {
                *latest = Some(runtime);
            }
        }

        if response.id != request_id {
            return Err(format!(
                "Semantic worker response id mismatch: expected {request_id}, received {}",
                response.id
            ));
        }
        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "Semantic worker request failed".to_string()));
        }

        validate_response_generation(response.state.as_ref(), expected_response_generation)?;
        publish_response_readiness(&method, response.state.as_ref(), &response.payload);
        Ok(response)
    }
}
