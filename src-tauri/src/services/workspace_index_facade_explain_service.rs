use crate::models::workspace::{WorkspaceIndexReadiness, WorkspaceIndexReadinessState};

pub fn explain_facade_query(
    kind: &str,
    readiness: &WorkspaceIndexReadiness,
    item_count: usize,
    confidence: Option<&str>,
) -> Vec<String> {
    let mut explain = vec![
        format!("query:{kind}"),
        format!("used:{}", used_indexes(kind).join(",")),
        format!("resultCount:{item_count}"),
        format!("readiness:{:?}", readiness.state),
        format!("requestedGeneration:{}", readiness.requested_generation),
        format!(
            "servedGeneration:{}",
            readiness
                .served_generation
                .map(|generation| generation.to_string())
                .unwrap_or_else(|| "none".to_string())
        ),
        format!("retryable:{}", readiness.retryable),
    ];
    if let Some(confidence) = confidence {
        explain.push(format!("confidence:{confidence}"));
    }
    if readiness.state != WorkspaceIndexReadinessState::Ready {
        explain.push(format!("skipped:{}", skipped_indexes(kind).join(",")));
        if let Some(reason) = readiness.reason.as_deref() {
            explain.push(format!("reason:{reason}"));
        }
    } else {
        explain.push("skipped:none".to_string());
    }
    explain.push(format!(
        "action:{}",
        recommended_query_action(readiness, item_count)
    ));
    explain
}

fn used_indexes(kind: &str) -> Vec<&'static str> {
    match kind {
        "definition" => vec!["FileIndex", "WorkspaceIndex", "SDKIndex", "ReferenceIndex"],
        "usages" => vec!["ReferenceIndex", "WorkspaceIndex"],
        "searchEverywhere" => vec!["FileIndex", "WorkspaceIndex", "SDKIndex", "TextIndex"],
        "fileSymbols" => vec!["FileIndex", "SymbolIndex"],
        "completion" => vec![
            "CurrentFileIndex",
            "WorkspaceIndex",
            "SDKIndex",
            "SnippetIndex",
        ],
        "textSearch" => vec!["TextIndex"],
        _ => vec!["WorkspaceIndex"],
    }
}

fn skipped_indexes(kind: &str) -> Vec<&'static str> {
    match kind {
        "definition" => vec!["definitionResultCommit"],
        "usages" => vec!["usageResultCommit"],
        "searchEverywhere" | "fileSymbols" => vec!["rankedResultCommit"],
        "completion" => vec!["completionResultCommit"],
        "textSearch" => vec!["textResultCommit"],
        _ => vec!["resultCommit"],
    }
}

fn recommended_query_action(
    readiness: &WorkspaceIndexReadiness,
    item_count: usize,
) -> &'static str {
    match readiness.state {
        WorkspaceIndexReadinessState::Ready if item_count > 0 => "useResults",
        WorkspaceIndexReadinessState::Ready => "showEmptyResult",
        _ if readiness.retryable => "waitForIndex",
        WorkspaceIndexReadinessState::Missing => "rebuildIndex",
        WorkspaceIndexReadinessState::Blocked => "inspectIndex",
        WorkspaceIndexReadinessState::Partial | WorkspaceIndexReadinessState::Stale => {
            "inspectIndex"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::explain_facade_query;
    use crate::models::workspace::{WorkspaceIndexReadiness, WorkspaceIndexReadinessState};

    #[test]
    fn ready_explain_reports_no_skipped_layer_and_use_results_action() {
        let explain = explain_facade_query(
            "searchEverywhere",
            &WorkspaceIndexReadiness {
                root_path: "/workspace".to_string(),
                requested_generation: 9,
                served_generation: Some(9),
                state: WorkspaceIndexReadinessState::Ready,
                reason: None,
                retryable: false,
            },
            2,
            Some("indexed"),
        );

        assert!(explain.iter().any(|line| line == "skipped:none"));
        assert!(explain.iter().any(|line| line == "requestedGeneration:9"));
        assert!(explain.iter().any(|line| line == "servedGeneration:9"));
        assert!(explain.iter().any(|line| line == "retryable:false"));
        assert!(explain.iter().any(|line| line == "action:useResults"));
    }

    #[test]
    fn blocked_explain_reports_retryable_wait_action_and_generation_gap() {
        let explain = explain_facade_query(
            "definition",
            &WorkspaceIndexReadiness {
                root_path: "/workspace".to_string(),
                requested_generation: 10,
                served_generation: Some(7),
                state: WorkspaceIndexReadinessState::Stale,
                reason: Some("Served generation 7 is stale".to_string()),
                retryable: true,
            },
            0,
            Some("indexed"),
        );

        assert!(explain
            .iter()
            .any(|line| line == "skipped:definitionResultCommit"));
        assert!(explain.iter().any(|line| line == "requestedGeneration:10"));
        assert!(explain.iter().any(|line| line == "servedGeneration:7"));
        assert!(explain.iter().any(|line| line == "retryable:true"));
        assert!(explain.iter().any(|line| line == "action:waitForIndex"));
    }
}
