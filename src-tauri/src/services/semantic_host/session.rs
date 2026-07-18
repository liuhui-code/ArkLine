use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, TryLockError};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::generation_tracker::SemanticDocumentGenerationTracker;
use super::process::SemanticWorkerProcessSpec;
use super::protocol::{SemanticDocumentPosition, SemanticRequest, SEMANTIC_PROTOCOL_VERSION};
use super::response_state::{
    publish_response_readiness, validate_response_generation, RawSemanticResponseState,
};
use super::transport::{DirectSemanticWorkerTransport, SemanticWorkerTransport};
use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, LanguageQueryRequest, SemanticWorkerRuntime,
};

#[cfg(not(test))]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(test)]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Deserialize)]
struct RawSemanticResponse {
    id: String,
    ok: bool,
    payload: Value,
    error: Option<String>,
    state: Option<RawSemanticResponseState>,
    runtime: Option<SemanticWorkerRuntime>,
}

pub struct SemanticWorkerSession {
    transport: Mutex<Box<dyn SemanticWorkerTransport>>,
    next_request_id: AtomicU64,
    document_generations: Arc<Mutex<SemanticDocumentGenerationTracker>>,
    latest_runtime: Mutex<Option<SemanticWorkerRuntime>>,
}

pub(super) enum IdleHealthProbe {
    Busy,
    Healthy,
    Failed(String),
}

impl SemanticWorkerSession {
    pub fn start(spec: &SemanticWorkerProcessSpec) -> Result<Self, String> {
        let transport = DirectSemanticWorkerTransport::start(spec)?;
        Ok(Self::from_transport(Box::new(transport)))
    }

    pub(super) fn from_transport(transport: Box<dyn SemanticWorkerTransport>) -> Self {
        Self::from_transport_with_generations(
            transport,
            Arc::new(Mutex::new(SemanticDocumentGenerationTracker::default())),
        )
    }

    pub(super) fn from_transport_with_generations(
        transport: Box<dyn SemanticWorkerTransport>,
        document_generations: Arc<Mutex<SemanticDocumentGenerationTracker>>,
    ) -> Self {
        Self {
            transport: Mutex::new(transport),
            next_request_id: AtomicU64::new(1),
            document_generations,
            latest_runtime: Mutex::new(None),
        }
    }

    pub fn runtime_snapshot(&self) -> Option<SemanticWorkerRuntime> {
        self.latest_runtime.lock().ok().and_then(|value| *value)
    }

    pub fn restore_tracked_documents(&self) -> Result<usize, String> {
        let documents = self
            .document_generations
            .lock()
            .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
            .replay_snapshot();
        if documents.is_empty() {
            return Ok(0);
        }
        let expected_count = documents.len();
        let response = self.send_payload(
            SemanticRequest {
                id: self.next_request_id(),
                method: "restoreDocuments".to_string(),
                position: None,
                action: None,
                documents: Some(documents),
            },
            None,
        )?;
        let restored_count = response
            .payload
            .get("restoredDocumentCount")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                "Semantic worker restore response omitted restoredDocumentCount".to_string()
            })? as usize;
        if restored_count != expected_count {
            return Err(format!(
                "Semantic worker restored {restored_count} of {expected_count} documents"
            ));
        }
        Ok(restored_count)
    }

    pub fn health(&self) -> Result<String, String> {
        let response = self.send_request("health", None)?;
        parse_health_response(&response)
    }

    pub(super) fn try_health(&self) -> IdleHealthProbe {
        let mut transport = match self.transport.try_lock() {
            Ok(transport) => transport,
            Err(TryLockError::WouldBlock) => return IdleHealthProbe::Busy,
            Err(TryLockError::Poisoned(_)) => {
                return IdleHealthProbe::Failed(
                    "Semantic worker transport lock is poisoned".to_string(),
                )
            }
        };
        let payload = SemanticRequest {
            id: self.next_request_id(),
            method: "health".to_string(),
            position: None,
            action: None,
            documents: None,
        };
        match self.exchange_payload(transport.as_mut(), payload, None) {
            Ok(response) => match parse_health_response(&response) {
                Ok(_) => IdleHealthProbe::Healthy,
                Err(error) => IdleHealthProbe::Failed(error),
            },
            Err(error) => IdleHealthProbe::Failed(error),
        }
    }

    pub fn goto_definition(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Option<DefinitionTarget>, String> {
        let response = self.send_request("gotoDefinition", Some(request))?;
        let payload = extract_payload(&response.payload, "definition");

        if payload.is_null() {
            return Ok(None);
        }

        if let Some(definition) = payload.get("definition") {
            if definition.is_null() {
                return Ok(None);
            }

            return parse_definition_target(definition).map(Some);
        }

        parse_definition_target(payload).map(Some)
    }

    pub fn goto_definition_candidates(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<DefinitionCandidate>, String> {
        let response = self.send_request("gotoDefinition", Some(request))?;
        let payload = extract_payload(&response.payload, "definition");

        if payload.is_null() {
            return Ok(Vec::new());
        }

        if let Some(candidates) = payload.get("definitionCandidates") {
            let items = candidates.as_array().ok_or_else(|| {
                "Semantic worker definitionCandidates response was not an array".to_string()
            })?;

            return items
                .iter()
                .map(parse_definition_candidate)
                .collect::<Result<Vec<_>, _>>();
        }

        parse_definition_candidate(payload).map(|candidate| vec![candidate])
    }

    pub fn completion(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<CompletionItem>, String> {
        let response = self.send_request("completion", Some(request))?;
        let payload = extract_payload(&response.payload, "completion");
        let items = payload
            .as_array()
            .ok_or_else(|| "Semantic worker completion response was not an array".to_string())?;

        Ok(items.iter().filter_map(parse_completion_item).collect())
    }

    pub fn list_code_actions(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<CodeAction>, String> {
        let response = self.send_request("listCodeActions", Some(request))?;
        let payload = extract_payload(&response.payload, "actions");
        let actions = payload
            .as_array()
            .ok_or_else(|| "Semantic worker code action response was not an array".to_string())?;

        actions
            .iter()
            .cloned()
            .map(|action| {
                serde_json::from_value(action).map_err(|error| {
                    format!("Failed to parse semantic worker code action: {error}")
                })
            })
            .collect()
    }

    pub fn resolve_code_action(
        &self,
        request: &CodeActionResolveRequest,
    ) -> Result<CodeActionResolution, String> {
        let response = self.send_action_request("resolveCodeAction", request)?;

        serde_json::from_value(response.payload).map_err(|error| {
            format!("Failed to parse semantic worker code action resolution: {error}")
        })
    }

    #[cfg(test)]
    pub fn process_id(&self) -> Option<u32> {
        self.transport
            .lock()
            .ok()
            .map(|transport| transport.process_id())
    }

    fn send_request(
        &self,
        method: &str,
        request: Option<&LanguageQueryRequest>,
    ) -> Result<RawSemanticResponse, String> {
        self.send_request_parts(method, request, None)
    }

    fn send_action_request(
        &self,
        method: &str,
        action: &CodeActionResolveRequest,
    ) -> Result<RawSemanticResponse, String> {
        self.send_request_parts(method, None, Some(action))
    }

    fn send_request_parts(
        &self,
        method: &str,
        request: Option<&LanguageQueryRequest>,
        action: Option<&CodeActionResolveRequest>,
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
            }),
            action: action.cloned(),
            documents: None,
        };
        let expected_response_generation = matches!(method, "completion" | "gotoDefinition")
            .then_some(content_generation)
            .flatten();
        self.send_payload(payload, expected_response_generation)
    }

    fn next_request_id(&self) -> String {
        format!(
            "semantic-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn send_payload(
        &self,
        payload: SemanticRequest,
        expected_response_generation: Option<u64>,
    ) -> Result<RawSemanticResponse, String> {
        let mut transport = self
            .transport
            .lock()
            .map_err(|_| "Semantic worker transport lock is poisoned".to_string())?;
        self.exchange_payload(transport.as_mut(), payload, expected_response_generation)
    }

    fn exchange_payload(
        &self,
        transport: &mut dyn SemanticWorkerTransport,
        payload: SemanticRequest,
        expected_response_generation: Option<u64>,
    ) -> Result<RawSemanticResponse, String> {
        let request_id = payload.id.clone();
        let method = payload.method.clone();
        let serialized = serde_json::to_string(&payload).map_err(|error| {
            format!("Failed to serialize semantic worker request {request_id}: {error}")
        })?;
        transport.write_line(&serialized).map_err(|error| {
            format!("Failed to write semantic worker request {request_id}: {error}")
        })?;
        let line = match transport.recv_line(SEMANTIC_WORKER_REQUEST_TIMEOUT) {
            Ok(line) => line,
            Err(error) => {
                transport.terminate();
                return Err(format!(
                    "Failed to read semantic worker response {request_id}: {error}"
                ));
            }
        };

        if line.trim().is_empty() {
            return Err(format!(
                "Semantic worker returned an empty response for {request_id}"
            ));
        }

        let response: RawSemanticResponse = serde_json::from_str(line.trim()).map_err(|error| {
            format!("Failed to parse semantic worker response {request_id}: {error}")
        })?;
        if let Some(runtime) = response.runtime {
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

fn parse_health_response(response: &RawSemanticResponse) -> Result<String, String> {
    let payload = extract_payload(&response.payload, "health");
    let status = payload
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Semantic worker health response did not include a status".to_string())?;
    let protocol_version = payload
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            "Semantic worker health response did not include a protocol version".to_string()
        })?;
    if protocol_version != SEMANTIC_PROTOCOL_VERSION {
        return Err(format!(
            "Semantic worker protocol mismatch: host {SEMANTIC_PROTOCOL_VERSION}, worker {protocol_version}"
        ));
    }
    Ok(status)
}

fn parse_definition_target(payload: &Value) -> Result<DefinitionTarget, String> {
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Semantic worker definition response did not include a path".to_string())?;
    let line = payload
        .get("line")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Semantic worker definition response did not include a line".to_string())?;
    let column = payload
        .get("column")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            "Semantic worker definition response did not include a column".to_string()
        })?;

    Ok(DefinitionTarget {
        path: path.to_string(),
        line: line as u32,
        column: column as u32,
    })
}

fn parse_definition_candidate(payload: &Value) -> Result<DefinitionCandidate, String> {
    let target = parse_definition_target(payload)?;

    Ok(DefinitionCandidate {
        path: target.path,
        line: target.line,
        column: target.column,
        preview: String::new(),
    })
}

pub(super) fn parse_completion_item(item: &Value) -> Option<CompletionItem> {
    Some(CompletionItem {
        label: item.get("label")?.as_str()?.to_string(),
        detail: item.get("detail")?.as_str()?.to_string(),
        kind: item.get("kind")?.as_str()?.to_string(),
        insert_text: item
            .get("insertText")
            .and_then(Value::as_str)
            .map(str::to_string),
        filter_text: item
            .get("filterText")
            .and_then(Value::as_str)
            .map(str::to_string),
        sort_text: item
            .get("sortText")
            .and_then(Value::as_str)
            .map(str::to_string),
        source: item
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string),
        documentation: item
            .get("documentation")
            .and_then(Value::as_str)
            .map(str::to_string),
        replacement_range: item.get("replacementRange").and_then(parse_text_range),
        commit_characters: item
            .get("commitCharacters")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        definition_target: item
            .get("definitionTarget")
            .and_then(|value| parse_definition_target(value).ok()),
        data: item.get("data").cloned(),
    })
}

fn parse_text_range(payload: &Value) -> Option<crate::models::language::TextRange> {
    Some(crate::models::language::TextRange {
        start_line: payload.get("startLine")?.as_u64()? as u32,
        start_column: payload.get("startColumn")?.as_u64()? as u32,
        end_line: payload.get("endLine")?.as_u64()? as u32,
        end_column: payload.get("endColumn")?.as_u64()? as u32,
    })
}

impl Drop for SemanticWorkerSession {
    fn drop(&mut self) {
        if let Ok(mut transport) = self.transport.lock() {
            transport.terminate();
        }
    }
}

fn extract_payload<'a>(payload: &'a Value, key: &str) -> &'a Value {
    payload.get(key).unwrap_or(payload)
}
