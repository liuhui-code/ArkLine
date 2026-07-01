#![allow(dead_code)]

use crate::models::language::{
    DefinitionCandidate, DefinitionTarget, LanguageQueryRequest, UsageResult,
};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceSearchCandidate,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_query_service::{
    query_definition_candidates_with_readiness, query_workspace_candidates_with_readiness,
    query_workspace_file_symbols_with_readiness, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_reference_index_service::query_reference_at_position;
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

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
    FileSymbols {
        root_path: String,
        file_path: String,
        query: String,
        limit: usize,
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceIndexFacadeEnvelope {
    pub items: Vec<WorkspaceIndexFacadeItem>,
    pub readiness: WorkspaceIndexReadiness,
    pub confidence: Option<String>,
    pub explain: Vec<String>,
}

pub fn query_workspace_index_facade(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceIndexFacadeRequest,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    match request {
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
        WorkspaceIndexFacadeRequest::FileSymbols {
            root_path,
            file_path,
            query,
            limit,
        } => query_facade_file_symbols(index_runtime, &root_path, &file_path, &query, limit),
        WorkspaceIndexFacadeRequest::Unsupported { root_path, kind } => {
            let _ = root_path;
            Err(format!(
                "Unsupported workspace index facade query: {}",
                kind.as_str()
            ))
        }
    }
}

pub fn query_facade_file_symbols_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let envelope = query_facade_file_symbols(index_runtime, root_path, file_path, query, limit)?;
    Ok(WorkspaceIndexQueryEnvelope {
        items: envelope
            .items
            .into_iter()
            .filter_map(|item| match item {
                WorkspaceIndexFacadeItem::Search(candidate) => Some(candidate),
                _ => None,
            })
            .collect(),
        readiness: envelope.readiness,
    })
}

pub fn query_facade_text_search_result(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    if should_use_indexed_text_search(&request) {
        return search_indexed_workspace_content(&request);
    }

    let index_state = index_runtime.get_index_state(&request.root_path)?;
    Ok(search_filesystem_text(&request, &index_state.file_paths))
}

pub fn query_facade_search_everywhere_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let envelope = query_facade_search_everywhere(index_runtime, root_path, query, scope, limit)?;
    Ok(WorkspaceIndexQueryEnvelope {
        items: envelope
            .items
            .into_iter()
            .filter_map(|item| match item {
                WorkspaceIndexFacadeItem::Search(candidate) => Some(candidate),
                _ => None,
            })
            .collect(),
        readiness: envelope.readiness,
    })
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
    Ok(WorkspaceIndexQueryEnvelope {
        items: envelope
            .items
            .into_iter()
            .filter_map(|item| match item {
                WorkspaceIndexFacadeItem::Definition(candidate) => Some(candidate),
                _ => None,
            })
            .collect(),
        readiness: envelope.readiness,
    })
}

pub fn query_facade_usages_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<UsageResult>, String> {
    let envelope = query_facade_usages(index_runtime, root_path, request, limit)?;
    Ok(WorkspaceIndexQueryEnvelope {
        items: envelope
            .items
            .into_iter()
            .filter_map(|item| match item {
                WorkspaceIndexFacadeItem::Usage(usage) => Some(usage),
                _ => None,
            })
            .collect(),
        readiness: envelope.readiness,
    })
}

fn query_facade_definition(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    semantic_target: Option<DefinitionTarget>,
    semantic_candidates: Vec<DefinitionCandidate>,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let confidence = confidence_at_position(root_path, request)?;
    let envelope = query_definition_candidates_with_readiness(
        index_runtime,
        root_path,
        request,
        semantic_target,
        semantic_candidates,
    )?;
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Definition)
            .collect(),
        readiness: envelope.readiness,
        confidence,
        explain: vec!["facade:definition".to_string()],
    })
}

fn query_facade_usages(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let confidence = confidence_at_position(root_path, request)?;
    let envelope = query_usages_with_readiness(index_runtime, root_path, request, limit)?;
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Usage)
            .collect(),
        readiness: envelope.readiness,
        confidence,
        explain: vec!["facade:usages".to_string()],
    })
}

fn query_facade_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexFacadeEnvelope, String> {
    let envelope =
        query_workspace_candidates_with_readiness(index_runtime, root_path, query, scope, limit)?;
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain: vec!["facade:searchEverywhere".to_string()],
    })
}

fn query_facade_file_symbols(
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
    Ok(WorkspaceIndexFacadeEnvelope {
        items: envelope
            .items
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Search)
            .collect(),
        readiness: envelope.readiness,
        confidence: Some("indexed".to_string()),
        explain: vec!["facade:fileSymbols".to_string()],
    })
}

fn confidence_at_position(
    root_path: &str,
    request: &LanguageQueryRequest,
) -> Result<Option<String>, String> {
    Ok(
        query_reference_at_position(root_path, &request.path, request.line, request.column)?
            .map(|reference| reference.confidence),
    )
}

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/') && !request.options.whole_word
}
