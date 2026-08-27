use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::generation_tracker::SemanticDocumentGenerationTracker;
use super::process::SemanticWorkerProcessSpec;
use super::protocol::{SemanticRequest, SEMANTIC_PROTOCOL_VERSION};
use super::request_actor::SemanticRequestActor;
use super::response_state::RawSemanticResponseState;
use super::transport::{DirectSemanticWorkerTransport, SemanticWorkerTransport};
use crate::models::diagnostics::ValidationQueryResult;
use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, LanguageQueryRequest, SemanticRequestActorSnapshot,
    SemanticWorkerRuntime, SignatureHelp, UsageQueryResult,
};

mod completion_resolution;
mod definition;
mod document_sync;
pub(super) mod query_results;
mod rename;
mod request;

#[cfg(not(test))]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(test)]
const SEMANTIC_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

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
    actor: SemanticRequestActor,
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
            actor: SemanticRequestActor::start(transport),
            next_request_id: AtomicU64::new(1),
            document_generations,
            latest_runtime: Mutex::new(None),
        }
    }

    pub fn runtime_snapshot(&self) -> Option<SemanticWorkerRuntime> {
        self.latest_runtime
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub(crate) fn request_actor_snapshot(&self) -> SemanticRequestActorSnapshot {
        self.actor.snapshot()
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
                completion: None,
                new_name: None,
                documents: Some(documents),
                document: None,
                document_path: None,
            },
            None,
            SEMANTIC_WORKER_REQUEST_TIMEOUT,
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
        if self.actor.is_busy() {
            return IdleHealthProbe::Busy;
        }
        match self.health() {
            Ok(_) => IdleHealthProbe::Healthy,
            Err(error) => IdleHealthProbe::Failed(error),
        }
    }

    pub fn completion(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<CompletionItem>, String> {
        self.completion_with_document_version(request, None)
    }

    pub fn completion_with_document_version(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
    ) -> Result<Vec<CompletionItem>, String> {
        let response = self.send_request_with_document_version(request, document_version)?;
        let payload = extract_payload(&response.payload, "completion");
        let items = payload
            .as_array()
            .ok_or_else(|| "Semantic worker completion response was not an array".to_string())?;

        Ok(items.iter().filter_map(parse_completion_item).collect())
    }

    pub fn signature_help(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Option<SignatureHelp>, String> {
        let response = self.send_request("signatureHelp", Some(request))?;
        let payload = extract_payload(&response.payload, "signatureHelp");
        if payload.is_null() {
            return Ok(None);
        }
        serde_json::from_value(payload.clone())
            .map(Some)
            .map_err(|error| format!("Failed to parse semantic worker signature help: {error}"))
    }

    pub fn usages(&self, request: &LanguageQueryRequest) -> Result<UsageQueryResult, String> {
        let response = self.send_request("findUsages", Some(request))?;
        let payload = extract_payload(&response.payload, "findUsages");
        let items = payload
            .as_array()
            .ok_or_else(|| "Semantic worker usages response was not an array".to_string())?;
        let items = items
            .iter()
            .filter_map(query_results::parse_usage_result)
            .collect();
        Ok(
            match response
                .state
                .as_ref()
                .and_then(|state| state.type_status.as_deref())
            {
                Some("ready") => UsageQueryResult::ready(items),
                Some("partial") => UsageQueryResult::partial(
                    items,
                    "Semantic type evidence is partial; usages may be incomplete",
                ),
                _ => UsageQueryResult::unavailable(
                    "Semantic worker could not provide authoritative usage evidence",
                ),
            },
        )
    }

    pub fn diagnostics(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<ValidationQueryResult, String> {
        let response = self.send_request("diagnostics", Some(request))?;
        query_results::parse_diagnostics_response(&response)
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
        Some(self.actor.process_id())
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

pub(super) fn parse_definition_target(payload: &Value) -> Result<DefinitionTarget, String> {
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

pub(super) fn parse_definition_candidate(payload: &Value) -> Result<DefinitionCandidate, String> {
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
        additional_text_edits: completion_resolution::parse_completion_text_edits(item),
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

pub(super) fn extract_payload<'a>(payload: &'a Value, key: &str) -> &'a Value {
    payload.get(key).unwrap_or(payload)
}
