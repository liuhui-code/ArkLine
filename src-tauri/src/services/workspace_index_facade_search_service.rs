use crate::models::workspace::{
    WorkspaceIndexReadiness, WorkspaceIndexReadinessState, WorkspaceSearchCandidate,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::models::workspace_index_layer::WorkspaceIndexLayerStatus;
use crate::services::workspace_content_index_service::search_indexed_workspace_content_with_cancellation;
use crate::services::workspace_content_readiness_store_service::load_content_layer_summary;
use crate::services::workspace_discovery_store_service::load_ready_discovered_files;
use crate::services::workspace_index_candidate_page_service::{
    query_workspace_candidate_page, query_workspace_file_symbol_page,
};
use crate::services::workspace_index_facade_explain_service::explain_facade_query;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};
use crate::services::workspace_index_layer_readiness_service::get_workspace_index_layer_readiness;
use crate::services::workspace_index_layer_readiness_store_service::{
    count_rows, normalize_layer_index_path, with_layer_readiness_store,
};
use crate::services::workspace_index_query_service::{
    readiness_for_index_runtime, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
#[path = "workspace_parallel_text_search_service.rs"]
mod parallel_text_search;
use crate::services::workspace_search_ranking_service::{
    sort_search_everywhere_candidates_with_context, WorkspaceSearchRankingContext,
};
use parallel_text_search::search_workspace_files_responsive;

const FILESYSTEM_TEXT_SEARCH_FILE_LIMIT: usize = 200_000;

#[derive(Clone, Copy)]
struct TextIndexCoverage {
    expected: i64,
    ready: i64,
}

impl TextIndexCoverage {
    fn is_missing(self) -> bool {
        self.expected == 0 || self.ready == 0
    }

    fn is_partial(self) -> bool {
        !self.is_missing() && self.ready < self.expected
    }

    fn confidence(self) -> &'static str {
        if self.is_missing() {
            "filesystemFallback"
        } else if self.is_partial() {
            "indexedPartial"
        } else {
            "indexed"
        }
    }
}

pub(crate) fn query_facade_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    query_facade_search_everywhere_page(index_runtime, root_path, query, scope, limit, None)
}

pub(crate) fn query_facade_search_everywhere_with_context(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    context: &WorkspaceSearchRankingContext,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    query_facade_search_everywhere_page_with_context(
        index_runtime,
        root_path,
        query,
        scope,
        limit,
        None,
        context,
    )
}

pub(crate) fn query_facade_search_everywhere_page(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    query_facade_search_everywhere_page_with_context(
        index_runtime,
        root_path,
        query,
        scope,
        limit,
        cursor,
        &WorkspaceSearchRankingContext::default(),
    )
}

pub(crate) fn query_facade_search_everywhere_page_with_context(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    cursor: Option<usize>,
    context: &WorkspaceSearchRankingContext,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    if scope == WorkspaceIndexQueryScope::Text {
        return query_facade_search_text_scope(index_runtime, root_path, query, limit);
    }
    let envelope =
        query_workspace_candidate_page(index_runtime, root_path, query, scope, limit, cursor)?;
    let mut items = envelope.items;
    sort_search_everywhere_candidates_with_context(&mut items, limit, context);
    let explain = explain_facade_query(
        "searchEverywhere",
        &envelope.readiness,
        items.len(),
        Some("indexed"),
    );
    let mut explain = explain;
    append_layer_explain(root_path, &mut explain)?;
    Ok(WorkspaceIndexFacadeEnvelope {
        items: items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain,
        next_cursor: envelope.next_cursor,
    })
}

pub(crate) fn query_facade_file_symbols(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    query_facade_file_symbols_page(index_runtime, root_path, file_path, query, limit, None)
}

pub(crate) fn query_facade_file_symbols_page(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
    cursor: Option<usize>,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let envelope = query_workspace_file_symbol_page(
        index_runtime,
        root_path,
        file_path,
        query,
        limit,
        cursor,
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
        next_cursor: envelope.next_cursor,
    })
}

pub(crate) fn query_facade_text_search(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    query_facade_text_search_with_cancellation(index_runtime, request, || false)
}

pub(crate) fn query_facade_text_search_with_cancellation<F>(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
    is_cancelled: F,
) -> Result<WorkspaceIndexFacadeEnvelope, String>
where
    F: FnMut() -> bool + Send + 'static,
{
    let mut readiness = readiness_for_index_runtime(index_runtime, &request.root_path)?;
    let coverage = text_index_coverage_for_request(&request)?;
    apply_text_index_coverage(&mut readiness, coverage);
    let result = raw_text_search_result_with_cancellation(
        index_runtime,
        request,
        is_cancelled,
        Some(coverage),
    )?;
    let confidence = coverage.confidence();
    let explain = text_explain(
        "textSearch",
        &readiness,
        1,
        confidence,
        coverage,
        Some(&result),
    );
    Ok(WorkspaceIndexFacadeEnvelope {
        items: vec![WorkspaceIndexFacadeItem::TextSearch(result)],
        readiness,
        confidence: Some(confidence.to_string()),
        explain,
        next_cursor: None,
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
        generation: None,
        cursor: None,
        options: crate::models::workspace::WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit,
        context_lines: 0,
    };
    let mut readiness = readiness_for_index_runtime(index_runtime, root_path)?;
    let coverage = text_index_coverage_for_request(&request)?;
    apply_text_index_coverage(&mut readiness, coverage);
    let result = raw_text_search_result(index_runtime, request)?;
    let confidence = coverage.confidence();
    let explain = text_explain(
        "searchEverywhere",
        &readiness,
        result.matches.len(),
        confidence,
        coverage,
        Some(&result),
    );
    let items = text_search_candidates_from_result(result, query, limit)
        .into_iter()
        .map(WorkspaceIndexFacadeItem::Search)
        .collect::<Vec<_>>();
    Ok(WorkspaceIndexFacadeEnvelope {
        items,
        readiness,
        confidence: Some(confidence.to_string()),
        explain,
        next_cursor: None,
    })
}

fn raw_text_search_result(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    raw_text_search_result_with_cancellation(index_runtime, request, || false, None)
}

fn raw_text_search_result_with_cancellation<F>(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
    is_cancelled: F,
    coverage: Option<TextIndexCoverage>,
) -> Result<WorkspaceTextSearchResult, String>
where
    F: FnMut() -> bool + Send + 'static,
{
    let coverage = match coverage {
        Some(coverage) => coverage,
        None => text_index_coverage_for_request(&request)?,
    };
    let missing_text_index = coverage.is_missing();
    if is_filesystem_cursor(&request) {
        let file_paths = filesystem_search_paths(index_runtime, &request.root_path)?;
        return Ok(search_workspace_files_responsive(
            &request,
            &file_paths,
            is_cancelled,
        ));
    }
    if should_use_indexed_text_search(&request) && !missing_text_index {
        let cancellation = std::sync::Arc::new(std::sync::Mutex::new(is_cancelled));
        let indexed = search_indexed_workspace_content_with_cancellation(&request, {
            let cancellation = cancellation.clone();
            move || invoke_cancellation(&cancellation)
        })?;
        if !coverage.is_partial() || !indexed.matches.is_empty() || request.cursor.is_some() {
            return Ok(indexed);
        }
        let file_paths = filesystem_search_paths(index_runtime, &request.root_path)?;
        return Ok(search_workspace_files_responsive(
            &request,
            &file_paths,
            move || invoke_cancellation(&cancellation),
        ));
    }

    let file_paths = filesystem_search_paths(index_runtime, &request.root_path)?;
    Ok(search_workspace_files_responsive(
        &request,
        &file_paths,
        is_cancelled,
    ))
}

fn invoke_cancellation<F>(cancellation: &std::sync::Arc<std::sync::Mutex<F>>) -> bool
where
    F: FnMut() -> bool,
{
    cancellation
        .lock()
        .map(|mut is_cancelled| is_cancelled())
        .unwrap_or(true)
}

fn filesystem_search_paths(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
) -> Result<Vec<String>, String> {
    if let Some(paths) = load_ready_discovered_files(root_path, FILESYSTEM_TEXT_SEARCH_FILE_LIMIT)?
    {
        return Ok(paths);
    }
    index_runtime.inspect_index_state(root_path, |state| state.file_paths.clone())
}

fn is_filesystem_cursor(request: &WorkspaceTextSearchRequest) -> bool {
    request
        .cursor
        .as_ref()
        .and_then(|cursor| cursor.source.as_deref())
        == Some("filesystem")
}

fn text_explain(
    kind: &str,
    readiness: &WorkspaceIndexReadiness,
    item_count: usize,
    confidence: &str,
    coverage: TextIndexCoverage,
    result: Option<&WorkspaceTextSearchResult>,
) -> Vec<String> {
    let mut explain = explain_facade_query(kind, readiness, item_count, Some(confidence));
    if coverage.is_missing() {
        explain.push("skipped:TextIndex:missing".to_string());
    } else if coverage.is_partial() {
        explain.push(format!(
            "used:TextIndex:partial:{}/{}",
            coverage.ready, coverage.expected
        ));
    }
    if let Some(result) = result {
        explain.push(format!("searchedFiles:{}", result.searched_files));
        explain.push(format!(
            "prefilterSkippedFiles:{}",
            result.prefilter_skipped_files
        ));
        explain.push(format!("limitReached:{}", result.limit_reached));
    }
    explain
}

fn append_layer_explain(root_path: &str, explain: &mut Vec<String>) -> Result<(), String> {
    let report = get_workspace_index_layer_readiness(root_path, None)?;
    push_layer_status(&report.layers, "projectFile", explain);
    push_layer_status(&report.layers, "sdkApi", explain);
    Ok(())
}

fn push_layer_status(
    layers: &[crate::models::workspace_index_layer::WorkspaceIndexLayerReadiness],
    name: &str,
    explain: &mut Vec<String>,
) {
    let status = layers
        .iter()
        .find(|layer| layer.layer == name)
        .map(|layer| layer_status_label(&layer.workspace_status))
        .unwrap_or("missing");
    explain.push(format!("layer:{name}:{status}"));
}

fn layer_status_label(status: &WorkspaceIndexLayerStatus) -> &'static str {
    match status {
        WorkspaceIndexLayerStatus::Ready => "ready",
        WorkspaceIndexLayerStatus::Partial => "partial",
        WorkspaceIndexLayerStatus::Stale => "stale",
        WorkspaceIndexLayerStatus::Failed => "failed",
        WorkspaceIndexLayerStatus::Missing => "missing",
    }
}

fn apply_text_index_coverage(readiness: &mut WorkspaceIndexReadiness, coverage: TextIndexCoverage) {
    if (coverage.is_missing() || coverage.is_partial())
        && readiness.state == WorkspaceIndexReadinessState::Ready
    {
        readiness.state = WorkspaceIndexReadinessState::Partial;
        readiness.retryable = true;
    }
    if coverage.is_missing() {
        readiness.reason =
            Some("Text index layer is missing; served filesystem fallback".to_string());
    } else if coverage.is_partial() {
        readiness.reason = Some(format!(
            "Text index is usable with partial coverage ({}/{} files)",
            coverage.ready, coverage.expected
        ));
    }
}

fn text_index_coverage_for_request(
    request: &WorkspaceTextSearchRequest,
) -> Result<TextIndexCoverage, String> {
    if !should_use_indexed_text_search(request) {
        return Ok(TextIndexCoverage {
            expected: 1,
            ready: 1,
        });
    }
    with_layer_readiness_store(&request.root_path, |connection| {
        let root_key = normalize_layer_index_path(&request.root_path);
        let expected = count_rows(connection, "workspace_files", &root_key)?;
        let content = load_content_layer_summary(connection, &root_key)?;
        Ok(TextIndexCoverage {
            expected,
            ready: content.ready_count,
        })
    })
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
    !query.is_empty() && !query.starts_with('/')
}
