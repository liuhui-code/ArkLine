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
    ];
    if let Some(confidence) = confidence {
        explain.push(format!("confidence:{confidence}"));
    }
    if readiness.state != WorkspaceIndexReadinessState::Ready {
        explain.push(format!("skipped:{}", skipped_indexes(kind).join(",")));
        if let Some(reason) = readiness.reason.as_deref() {
            explain.push(format!("reason:{reason}"));
        }
    }
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
