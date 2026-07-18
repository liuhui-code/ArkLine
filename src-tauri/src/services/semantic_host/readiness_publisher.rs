use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;

use serde_json::Value;

use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_semantic_layer_state_service::publish_semantic_layer_generations;

#[derive(Debug, Clone)]
pub(super) struct SemanticReadinessEvidence {
    pub path: String,
    pub layer: String,
    pub content_generation: u64,
    pub dependency_generation: u64,
    pub result_count: i64,
    pub status: String,
}

pub(super) fn enqueue_semantic_readiness(evidence: SemanticReadinessEvidence) {
    let _ = publisher().send(evidence);
}

pub(super) fn enqueue_semantic_response_readiness(
    method: &str,
    path: Option<&str>,
    content_generation: u64,
    dependency_generation: Option<u64>,
    syntax_ready: bool,
    type_status: Option<&str>,
    payload: &Value,
) {
    let Some(path) = path else {
        return;
    };
    if syntax_ready {
        enqueue_semantic_readiness(SemanticReadinessEvidence {
            path: path.to_string(),
            layer: "editorSyntax".to_string(),
            content_generation,
            dependency_generation: dependency_generation.unwrap_or_default(),
            result_count: 0,
            status: "ready".to_string(),
        });
    }
    if method == "gotoDefinition" {
        enqueue_semantic_readiness(SemanticReadinessEvidence {
            path: path.to_string(),
            layer: "editorDefinitions".to_string(),
            content_generation,
            dependency_generation: dependency_generation.unwrap_or_default(),
            result_count: definition_result_count(payload),
            status: "ready".to_string(),
        });
    }
    if matches!(type_status, Some("ready" | "partial")) {
        enqueue_semantic_readiness(SemanticReadinessEvidence {
            path: path.to_string(),
            layer: "editorTypes".to_string(),
            content_generation,
            dependency_generation: dependency_generation.unwrap_or_default(),
            result_count: semantic_result_count(method, payload),
            status: type_status.unwrap_or("partial").to_string(),
        });
    }
}

fn publisher() -> &'static Sender<SemanticReadinessEvidence> {
    static PUBLISHER: OnceLock<Sender<SemanticReadinessEvidence>> = OnceLock::new();
    PUBLISHER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<SemanticReadinessEvidence>();
        let _ = std::thread::Builder::new()
            .name("arkline-semantic-readiness-publisher".to_string())
            .spawn(move || {
                while let Ok(evidence) = receiver.recv() {
                    let _ = publish_semantic_readiness(&evidence);
                }
            });
        sender
    })
}

fn publish_semantic_readiness(evidence: &SemanticReadinessEvidence) -> Result<(), String> {
    let Some(root) = find_indexed_workspace_root(&evidence.path) else {
        return Ok(());
    };
    let root_path = root.to_string_lossy().to_string();
    let root_key = normalize_path(&root_path);
    with_workspace_index_writer(&root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        publish_semantic_layer_generations(
            connection,
            &root_key,
            &evidence.path,
            &evidence.layer,
            &evidence.status,
            evidence.content_generation,
            evidence.dependency_generation,
            evidence.result_count,
            None,
        )
    })
}

fn find_indexed_workspace_root(path: &str) -> Option<PathBuf> {
    let path = Path::new(path);
    let mut current = if path.is_dir() {
        Some(path)
    } else {
        path.parent()
    };
    while let Some(candidate) = current {
        if candidate
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite")
            .is_file()
        {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn normalize_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn definition_result_count(payload: &Value) -> i64 {
    if let Some(candidates) = payload
        .get("definitionCandidates")
        .and_then(Value::as_array)
    {
        return candidates.len() as i64;
    }
    if let Some(definition) = payload.get("definition") {
        return i64::from(!definition.is_null());
    }
    i64::from(!payload.is_null())
}

fn semantic_result_count(method: &str, payload: &Value) -> i64 {
    if method == "completion" {
        return payload.as_array().map_or(0, |items| items.len() as i64);
    }
    definition_result_count(payload)
}

#[cfg(test)]
pub(super) fn publish_semantic_readiness_for_test(
    evidence: &SemanticReadinessEvidence,
) -> Result<(), String> {
    publish_semantic_readiness(evidence)
}
