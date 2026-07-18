use serde::Deserialize;
use serde_json::Value;

use super::readiness_publisher::enqueue_semantic_response_readiness;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawSemanticResponseState {
    pub content_generation: u64,
    #[serde(default)]
    pub dependency_generation: Option<u64>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub syntax_ready: bool,
    #[serde(default)]
    pub type_status: Option<String>,
}

pub(super) fn publish_response_readiness(
    method: &str,
    state: Option<&RawSemanticResponseState>,
    payload: &Value,
) {
    let Some(state) = state else {
        return;
    };
    enqueue_semantic_response_readiness(
        method,
        state.path.as_deref(),
        state.content_generation,
        state.dependency_generation,
        state.syntax_ready,
        state.type_status.as_deref(),
        payload,
    );
}

pub(super) fn validate_response_generation(
    state: Option<&RawSemanticResponseState>,
    expected: Option<u64>,
) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let actual = state.map(|state| state.content_generation).ok_or_else(|| {
        "Semantic worker response did not include document generation".to_string()
    })?;
    if actual != expected {
        return Err(format!(
            "Semantic worker served stale document generation: expected {expected}, received {actual}"
        ));
    }
    Ok(())
}
