use crate::models::workspace::{WorkspaceIndexReadiness, WorkspaceIndexReadinessState};

pub fn readiness_for_query(
    root_path: &str,
    requested_generation: u64,
    served_generation: Option<u64>,
    partial_reason: Option<&str>,
) -> WorkspaceIndexReadiness {
    if let Some(reason) = partial_reason {
        return WorkspaceIndexReadiness {
            root_path: root_path.to_string(),
            requested_generation,
            served_generation,
            state: WorkspaceIndexReadinessState::Partial,
            sources: vec!["workspaceIndex".to_string()],
            coverage: Some("project".to_string()),
            fallback_used: false,
            reason: Some(reason.to_string()),
            retryable: true,
        };
    }

    let Some(served_generation) = served_generation else {
        return WorkspaceIndexReadiness {
            root_path: root_path.to_string(),
            requested_generation,
            served_generation: None,
            state: WorkspaceIndexReadinessState::Missing,
            sources: vec!["workspaceIndex".to_string()],
            coverage: Some("none".to_string()),
            fallback_used: false,
            reason: Some("No indexed generation is available".to_string()),
            retryable: true,
        };
    };

    if served_generation < requested_generation {
        return WorkspaceIndexReadiness {
            root_path: root_path.to_string(),
            requested_generation,
            served_generation: Some(served_generation),
            state: WorkspaceIndexReadinessState::Stale,
            sources: vec!["workspaceIndex".to_string()],
            coverage: Some("project".to_string()),
            fallback_used: false,
            reason: Some(format!(
                "Served generation {served_generation} is older than requested generation {requested_generation}"
            )),
            retryable: true,
        };
    }

    WorkspaceIndexReadiness {
        root_path: root_path.to_string(),
        requested_generation,
        served_generation: Some(served_generation),
        state: WorkspaceIndexReadinessState::Ready,
        sources: vec!["workspaceIndex".to_string()],
        coverage: Some("project".to_string()),
        fallback_used: false,
        reason: None,
        retryable: false,
    }
}
