#![allow(dead_code)]

use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, LanguageQueryRequest, UsageResult,
};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceSearchCandidate,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_index_facade_completion_service::query_facade_completion;
use crate::services::workspace_index_facade_envelope_service::{
    completion_query_envelope, definition_query_envelope, search_query_envelope,
    usage_query_envelope,
};
use crate::services::workspace_index_facade_event_service::record_facade_query_event;
use crate::services::workspace_index_facade_navigation_service::{
    query_facade_definition, query_facade_usages,
};
use crate::services::workspace_index_facade_search_service::{
    query_facade_file_symbols, query_facade_search_everywhere,
    query_facade_search_everywhere_with_context, query_facade_text_search,
    query_facade_text_search_with_cancellation,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_search_ranking_service::WorkspaceSearchRankingContext;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexFacadeKind {
    Definition,
    Usages,
    SearchEverywhere,
    FileSymbols,
    Completion,
    TextSearch,
}

impl WorkspaceIndexFacadeKind {
    fn as_str(self) -> &'static str {
        match self {
            WorkspaceIndexFacadeKind::Definition => "definition",
            WorkspaceIndexFacadeKind::Usages => "usages",
            WorkspaceIndexFacadeKind::SearchEverywhere => "searchEverywhere",
            WorkspaceIndexFacadeKind::FileSymbols => "fileSymbols",
            WorkspaceIndexFacadeKind::Completion => "completion",
            WorkspaceIndexFacadeKind::TextSearch => "textSearch",
        }
    }
}

pub enum WorkspaceIndexFacadeRequest {
    Definition {
        root_path: String,
        request: LanguageQueryRequest,
        semantic_target: Option<DefinitionTarget>,
        semantic_candidates: Vec<DefinitionCandidate>,
    },
    Usages {
        root_path: String,
        request: LanguageQueryRequest,
        limit: usize,
    },
    SearchEverywhere {
        root_path: String,
        query: String,
        scope: WorkspaceIndexQueryScope,
        limit: usize,
    },
    SearchEverywhereWithContext {
        root_path: String,
        query: String,
        scope: WorkspaceIndexQueryScope,
        limit: usize,
        context: WorkspaceSearchRankingContext,
    },
    FileSymbols {
        root_path: String,
        file_path: String,
        query: String,
        limit: usize,
    },
    Completion {
        root_path: String,
        request: LanguageQueryRequest,
        limit: usize,
    },
    TextSearch {
        request: WorkspaceTextSearchRequest,
    },
    Unsupported {
        root_path: String,
        kind: WorkspaceIndexFacadeKind,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum WorkspaceIndexFacadeItem {
    Definition(DefinitionCandidate),
    Usage(UsageResult),
    Search(WorkspaceSearchCandidate),
    Completion(CompletionItem),
    TextSearch(WorkspaceTextSearchResult),
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceIndexFacadeEnvelope {
    pub items: Vec<WorkspaceIndexFacadeItem>,
    pub readiness: WorkspaceIndexReadiness,
    pub confidence: Option<String>,
    pub explain: Vec<String>,
    pub next_cursor: Option<usize>,
}

pub fn query_workspace_index_facade(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceIndexFacadeRequest,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let root_path = facade_request_root_path(&request).to_string();
    let kind = facade_request_kind(&request);
    let envelope = match request {
        WorkspaceIndexFacadeRequest::Definition {
            root_path,
            request,
            semantic_target,
            semantic_candidates,
        } => query_facade_definition(
            index_runtime,
            &root_path,
            &request,
            semantic_target,
            semantic_candidates,
        ),
        WorkspaceIndexFacadeRequest::Usages {
            root_path,
            request,
            limit,
        } => query_facade_usages(index_runtime, &root_path, &request, limit),
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path,
            query,
            scope,
            limit,
        } => query_facade_search_everywhere(index_runtime, &root_path, &query, scope, limit),
        WorkspaceIndexFacadeRequest::SearchEverywhereWithContext {
            root_path,
            query,
            scope,
            limit,
            context,
        } => query_facade_search_everywhere_with_context(
            index_runtime,
            &root_path,
            &query,
            scope,
            limit,
            &context,
        ),
        WorkspaceIndexFacadeRequest::FileSymbols {
            root_path,
            file_path,
            query,
            limit,
        } => query_facade_file_symbols(index_runtime, &root_path, &file_path, &query, limit),
        WorkspaceIndexFacadeRequest::Completion {
            root_path,
            request,
            limit,
        } => query_facade_completion(index_runtime, &root_path, &request, limit),
        WorkspaceIndexFacadeRequest::TextSearch { request } => {
            query_facade_text_search(index_runtime, request)
        }
        WorkspaceIndexFacadeRequest::Unsupported { root_path, kind } => {
            let _ = root_path;
            Err(format!(
                "Unsupported workspace index facade query: {}",
                kind.as_str()
            ))
        }
    }?;
    record_facade_query_event(&root_path, kind, &envelope)?;
    Ok(envelope)
}

pub fn query_facade_file_symbols_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let envelope = query_facade_file_symbols(index_runtime, root_path, file_path, query, limit)?;
    record_facade_query_event(root_path, "fileSymbols", &envelope)?;
    Ok(search_query_envelope(envelope))
}

pub fn query_facade_text_search_result(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    query_facade_text_search_result_with_cancellation(index_runtime, request, || false)
}

pub fn query_facade_text_search_result_with_cancellation<F>(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
    is_cancelled: F,
) -> Result<WorkspaceTextSearchResult, String>
where
    F: FnMut() -> bool,
{
    let root_path = request.root_path.clone();
    let envelope =
        query_facade_text_search_with_cancellation(index_runtime, request, is_cancelled)?;
    record_facade_query_event(&root_path, "textSearch", &envelope)?;
    envelope
        .items
        .into_iter()
        .find_map(|item| match item {
            WorkspaceIndexFacadeItem::TextSearch(result) => Some(result),
            _ => None,
        })
        .ok_or_else(|| "Text search facade returned no text search result".to_string())
}

pub fn query_facade_search_everywhere_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    query_facade_search_everywhere_with_readiness_context(
        index_runtime,
        root_path,
        query,
        scope,
        limit,
        &WorkspaceSearchRankingContext::default(),
    )
}

pub fn query_facade_search_everywhere_with_readiness_context(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
    context: &WorkspaceSearchRankingContext,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let envelope = query_facade_search_everywhere_with_context(
        index_runtime,
        root_path,
        query,
        scope,
        limit,
        context,
    )?;
    record_facade_query_event(root_path, "searchEverywhere", &envelope)?;
    Ok(search_query_envelope(envelope))
}

pub fn query_facade_definition_candidates_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    semantic_target: Option<DefinitionTarget>,
    semantic_candidates: Vec<DefinitionCandidate>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    let envelope = query_facade_definition(
        index_runtime,
        root_path,
        request,
        semantic_target,
        semantic_candidates,
    )?;
    record_facade_query_event(root_path, "definition", &envelope)?;
    Ok(definition_query_envelope(envelope))
}

pub fn query_facade_usages_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<UsageResult>, String> {
    let envelope = query_facade_usages(index_runtime, root_path, request, limit)?;
    record_facade_query_event(root_path, "usages", &envelope)?;
    Ok(usage_query_envelope(envelope))
}

pub fn query_facade_completions_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<CompletionItem>, String> {
    let envelope = query_facade_completion(index_runtime, root_path, request, limit)?;
    record_facade_query_event(root_path, "completion", &envelope)?;
    Ok(completion_query_envelope(envelope))
}

fn facade_request_kind(request: &WorkspaceIndexFacadeRequest) -> &'static str {
    match request {
        WorkspaceIndexFacadeRequest::Definition { .. } => "definition",
        WorkspaceIndexFacadeRequest::Usages { .. } => "usages",
        WorkspaceIndexFacadeRequest::SearchEverywhere { .. }
        | WorkspaceIndexFacadeRequest::SearchEverywhereWithContext { .. } => "searchEverywhere",
        WorkspaceIndexFacadeRequest::FileSymbols { .. } => "fileSymbols",
        WorkspaceIndexFacadeRequest::Completion { .. } => "completion",
        WorkspaceIndexFacadeRequest::TextSearch { .. } => "textSearch",
        WorkspaceIndexFacadeRequest::Unsupported { kind, .. } => kind.as_str(),
    }
}

fn facade_request_root_path(request: &WorkspaceIndexFacadeRequest) -> &str {
    match request {
        WorkspaceIndexFacadeRequest::Definition { root_path, .. }
        | WorkspaceIndexFacadeRequest::Usages { root_path, .. }
        | WorkspaceIndexFacadeRequest::SearchEverywhere { root_path, .. }
        | WorkspaceIndexFacadeRequest::SearchEverywhereWithContext { root_path, .. }
        | WorkspaceIndexFacadeRequest::FileSymbols { root_path, .. }
        | WorkspaceIndexFacadeRequest::Completion { root_path, .. }
        | WorkspaceIndexFacadeRequest::Unsupported { root_path, .. } => root_path,
        WorkspaceIndexFacadeRequest::TextSearch { request } => &request.root_path,
    }
}
