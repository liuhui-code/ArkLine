use crate::models::workspace::{
    WorkspaceIndexReadiness, WorkspaceIndexReadinessState, WorkspaceSearchCandidate,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_facade_explain_service::explain_facade_query;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness;
use crate::services::workspace_index_query_service::{
    query_workspace_candidates_with_readiness, query_workspace_file_symbols_with_readiness,
    WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;

pub fn query_facade_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    if scope == WorkspaceIndexQueryScope::Text {
        return query_facade_search_text_scope(index_runtime, root_path, query, limit);
    }
    let envelope =
        query_workspace_candidates_with_readiness(index_runtime, root_path, query, scope, limit)?;
    let explain = explain_facade_query(
        "searchEverywhere",
        &envelope.readiness,
        envelope.items.len(),
        Some("indexed"),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain,
    })
}

pub fn query_facade_file_symbols(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let envelope = query_workspace_file_symbols_with_readiness(
        index_runtime,
        root_path,
        file_path,
        query,
        limit,
    )?;
    let explain = explain_facade_query(
        "fileSymbols",
        &envelope.readiness,
        envelope.items.len(),
        Some("indexed"),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain,
    })
}

pub fn query_facade_text_search(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let mut readiness = crate::services::workspace_index_query_service::readiness_for_index_state(
        &index_runtime.get_index_state(&request.root_path)?,
    );
    let missing_text_index = text_index_missing_for_request(&request)?;
    if missing_text_index {
        downgrade_missing_text_index(&mut readiness);
    }
    let result = raw_text_search_result(index_runtime, request)?;
    let confidence = if missing_text_index {
        "filesystemFallback"
    } else {
        "indexed"
    };
    let explain = text_explain("textSearch", &readiness, 1, confidence, missing_text_index);
    Ok(WorkspaceIndexFacadeEnvelope {
        items: vec![WorkspaceIndexFacadeItem::TextSearch(result)],
        readiness,
        confidence: Some(confidence.to_string()),
        explain,
    })
}

fn query_facade_search_text_scope(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let request = WorkspaceTextSearchRequest {
        root_path: root_path.to_string(),
        query: query.to_string(),
        options: crate::models::workspace::WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit,
        context_lines: 0,
    };
    let mut readiness = crate::services::workspace_index_query_service::readiness_for_index_state(
        &index_runtime.get_index_state(root_path)?,
    );
    let missing_text_index = text_index_missing_for_request(&request)?;
    if missing_text_index {
        downgrade_missing_text_index(&mut readiness);
    }
    let result = raw_text_search_result(index_runtime, request)?;
    let items = text_search_candidates_from_result(result, query, limit)
        .into_iter()
        .map(WorkspaceIndexFacadeItem::Search)
        .collect::<Vec<_>>();
    let confidence = if missing_text_index {
        "filesystemFallback"
    } else {
        "indexed"
    };
    let explain = text_explain(
        "searchEverywhere",
        &readiness,
        items.len(),
        confidence,
        missing_text_index,
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items,
        readiness,
        confidence: Some(confidence.to_string()),
        explain,
    })
}

fn raw_text_search_result(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    if should_use_indexed_text_search(&request) && !text_index_missing_for_request(&request)? {
        return search_indexed_workspace_content(&request);
    }

    let index_state = index_runtime.get_index_state(&request.root_path)?;
    Ok(search_filesystem_text(&request, &index_state.file_paths))
}

fn text_explain(
    kind: &str,
    readiness: &WorkspaceIndexReadiness,
    item_count: usize,
    confidence: &str,
    missing_text_index: bool,
) -> Vec<String> {
    let mut explain = explain_facade_query(kind, readiness, item_count, Some(confidence));
    if missing_text_index {
        explain.push("skipped:TextIndex:missing".to_string());
    }
    explain
}

fn downgrade_missing_text_index(readiness: &mut WorkspaceIndexReadiness) {
    if readiness.state == WorkspaceIndexReadinessState::Ready {
        readiness.state = WorkspaceIndexReadinessState::Partial;
        readiness.retryable = true;
    }
    readiness.reason = Some("Text index layer is missing; served filesystem fallback".to_string());
}

fn text_index_missing_for_request(request: &WorkspaceTextSearchRequest) -> Result<bool, String> {
    if !should_use_indexed_text_search(request) {
        return Ok(false);
    }
    let report = get_workspace_index_layer_readiness(&request.root_path, None)?;
    let Some(content) = report.layers.iter().find(|layer| layer.layer == "content") else {
        return Ok(true);
    };
    Ok(content.workspace_status != WorkspaceIndexLayerStatus::Ready)
}

fn text_search_candidates_from_result(
    result: WorkspaceTextSearchResult,
    query: &str,
    limit: usize,
) -> Vec<WorkspaceSearchCandidate> {
    let mut candidates = result
        .matches
        .into_iter()
        .enumerate()
        .map(|(index, matched)| WorkspaceSearchCandidate {
            id: format!("text:{}:{}:{}", matched.path, matched.line, matched.column),
            source: "text".to_string(),
            kind: "text".to_string(),
            title: matched.summary,
            subtitle: format!("{}:{}", matched.relative_path, matched.line),
            path: Some(matched.path),
            line: Some(matched.line),
            column: Some(matched.column),
            score: 20.0 - index as f64 * 0.01,
            freshness: "partial".to_string(),
            container: None,
            signature: Some(matched.preview),
            visibility: None,
        })
        .collect::<Vec<_>>();
    crate::services::workspace_search_ranking_service::sort_text_candidates_by_lexical_match(
        &mut candidates,
        query,
    );
    candidates.truncate(limit);
    candidates
}

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/') && !request.options.whole_word
}
