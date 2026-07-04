use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexReadinessState};
use crate::services::workspace_index_event_service::store_index_event;
use crate::services::workspace_index_facade_service::WorkspaceIndexFacadeEnvelope;

pub fn record_facade_query_event(
    root_path: &str,
    kind: &str,
    envelope: &WorkspaceIndexFacadeEnvelope,
) -> Result<(), String> {
    store_index_event(
        root_path,
        &WorkspaceIndexEvent {
            event_id: format!(
                "facade:{kind}:{}:{}",
                envelope.readiness.requested_generation,
                current_time_nanos()
            ),
            root_path: normalize_index_path(root_path),
            scope: "query".to_string(),
            kind: kind.to_string(),
            phase: facade_event_phase(envelope).to_string(),
            severity: facade_event_severity(envelope).to_string(),
            message: facade_event_message(kind, envelope),
            task_id: None,
            generation: Some(envelope.readiness.requested_generation),
            payload_json: serde_json::json!({
                "kind": kind,
                "explain": envelope.explain,
                "confidence": envelope.confidence,
                "itemCount": envelope.items.len(),
                "readiness": envelope.readiness,
            })
            .to_string(),
            created_at: current_time_millis(),
        },
    )
}

fn facade_event_phase(envelope: &WorkspaceIndexFacadeEnvelope) -> &'static str {
    match envelope.readiness.state {
        WorkspaceIndexReadinessState::Ready if envelope.items.is_empty() => "miss",
        WorkspaceIndexReadinessState::Ready => "hit",
        _ => "blocked",
    }
}

fn facade_event_severity(envelope: &WorkspaceIndexFacadeEnvelope) -> &'static str {
    match envelope.readiness.state {
        WorkspaceIndexReadinessState::Ready if envelope.items.is_empty() => "warning",
        WorkspaceIndexReadinessState::Ready => "info",
        _ => "warning",
    }
}

fn facade_event_message(kind: &str, envelope: &WorkspaceIndexFacadeEnvelope) -> String {
    if envelope.readiness.state != WorkspaceIndexReadinessState::Ready {
        return envelope
            .readiness
            .reason
            .clone()
            .unwrap_or_else(|| format!("{kind} query blocked by index readiness"));
    }
    if envelope.items.is_empty() {
        return format!("{kind} query returned no indexed results");
    }
    format!(
        "{kind} query returned {} indexed result(s)",
        envelope.items.len()
    )
}

fn current_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn current_time_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
