use crate::models::language::{
    CompletionItem, DefinitionCandidate, LanguageQueryBrokerEnvelope, LanguageQueryRequest,
};
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_completion_item_service::dedupe_completion_items;
use crate::services::workspace_completion_parser_service::is_member_access_context;
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};

pub(crate) mod deadline;

const COMPLETION_LIMIT: usize = 100;

pub fn assemble_language_definition(
    request_generation: u64,
    semantic_candidates: Vec<DefinitionCandidate>,
    semantic_error: Option<String>,
    mut facade: WorkspaceIndexFacadeEnvelope,
) -> LanguageQueryBrokerEnvelope<DefinitionCandidate> {
    let semantic_ready = !semantic_candidates.is_empty();
    if semantic_ready {
        facade.items = semantic_candidates
            .into_iter()
            .map(WorkspaceIndexFacadeItem::Definition)
            .collect();
    }
    let provider = if semantic_ready {
        "semantic"
    } else if facade.items.is_empty() {
        "none"
    } else {
        "index"
    };
    definition_envelope(facade, request_generation, provider, semantic_error)
}

pub fn assemble_language_completion(
    request: &LanguageQueryRequest,
    request_generation: u64,
    document_generation: Option<u64>,
    language_items: Vec<CompletionItem>,
    semantic_error: Option<String>,
    facade: WorkspaceIndexFacadeEnvelope,
) -> LanguageQueryBrokerEnvelope<CompletionItem> {
    let indexed_items = facade
        .items
        .iter()
        .filter_map(|item| match item {
            WorkspaceIndexFacadeItem::Completion(item) => Some(item.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let semantic_count = language_items.len();
    let indexed_count = indexed_items.len();
    let items = merge_completion_sources(request, language_items, indexed_items);
    let provider = provider_for_counts(semantic_count, indexed_count);
    completion_envelope(
        facade,
        items,
        request_generation,
        document_generation,
        provider,
        semantic_error,
    )
}

fn definition_envelope(
    facade: WorkspaceIndexFacadeEnvelope,
    request_generation: u64,
    provider: &str,
    semantic_error: Option<String>,
) -> LanguageQueryBrokerEnvelope<DefinitionCandidate> {
    let items = facade
        .items
        .into_iter()
        .filter_map(|item| match item {
            WorkspaceIndexFacadeItem::Definition(item) => Some(item),
            _ => None,
        })
        .collect::<Vec<_>>();
    broker_envelope(
        items,
        facade.readiness,
        request_generation,
        None,
        provider,
        facade.confidence,
        semantic_error,
        facade.explain,
    )
}

fn completion_envelope(
    facade: WorkspaceIndexFacadeEnvelope,
    items: Vec<CompletionItem>,
    request_generation: u64,
    document_generation: Option<u64>,
    provider: &str,
    semantic_error: Option<String>,
) -> LanguageQueryBrokerEnvelope<CompletionItem> {
    broker_envelope(
        items,
        facade.readiness,
        request_generation,
        document_generation,
        provider,
        facade.confidence,
        semantic_error,
        facade.explain,
    )
}

#[allow(clippy::too_many_arguments)]
fn broker_envelope<T>(
    items: Vec<T>,
    readiness: crate::models::workspace::WorkspaceIndexReadiness,
    request_generation: u64,
    document_generation: Option<u64>,
    provider: &str,
    facade_confidence: Option<String>,
    semantic_error: Option<String>,
    mut explain: Vec<String>,
) -> LanguageQueryBrokerEnvelope<T> {
    let target_generation = if provider.starts_with("semantic") {
        document_generation
    } else {
        readiness.served_generation
    };
    let fallback_used = provider == "index";
    let confidence = confidence(provider, facade_confidence, &readiness.state);
    explain.push(format!("provider:{provider}"));
    explain.push(format!("requestGeneration:{request_generation}"));
    if let Some(generation) = document_generation {
        explain.push(format!("documentGeneration:{generation}"));
    }
    if let Some(error) = semantic_error.as_deref() {
        explain.push(format!("semanticError:{error}"));
    }
    let miss_reason = items.is_empty().then(|| {
        readiness
            .reason
            .clone()
            .unwrap_or_else(|| "No authoritative language target was found".to_string())
    });
    LanguageQueryBrokerEnvelope {
        items,
        readiness,
        request_generation,
        document_generation,
        target_generation,
        provider: provider.to_string(),
        confidence,
        fallback_used,
        miss_reason,
        explain,
    }
}

fn merge_completion_sources(
    request: &LanguageQueryRequest,
    language_items: Vec<CompletionItem>,
    indexed_items: Vec<CompletionItem>,
) -> Vec<CompletionItem> {
    let member_access = is_member_access_context(request);
    let items = language_items
        .into_iter()
        .chain(indexed_items)
        .filter(|item| !member_access || is_receiver_member(&request.path, item))
        .collect();
    dedupe_completion_items(items, COMPLETION_LIMIT)
}

fn is_receiver_member(path: &str, item: &CompletionItem) -> bool {
    if item.kind == "keyword" || item.kind == "snippet" {
        return false;
    }
    let label = item.label.strip_suffix("()").unwrap_or(&item.label);
    !(path.to_ascii_lowercase().ends_with(".ets") && label == "build")
}

fn provider_for_counts(semantic_count: usize, indexed_count: usize) -> &'static str {
    match (semantic_count > 0, indexed_count > 0) {
        (true, true) => "semantic+index",
        (true, false) => "semantic",
        (false, true) => "index",
        (false, false) => "none",
    }
}

fn confidence(
    provider: &str,
    facade_confidence: Option<String>,
    readiness: &WorkspaceIndexReadinessState,
) -> String {
    if !matches!(readiness, WorkspaceIndexReadinessState::Ready) {
        return "partial".to_string();
    }
    if provider.starts_with("semantic") {
        return "semantic".to_string();
    }
    facade_confidence.unwrap_or_else(|| {
        if provider == "index" {
            "indexed"
        } else {
            "none"
        }
        .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{broker_envelope, merge_completion_sources};
    use crate::models::language::{CompletionItem, LanguageQueryRequest};
    use crate::models::workspace::{WorkspaceIndexReadiness, WorkspaceIndexReadinessState};

    #[test]
    fn member_access_rejects_declaration_keywords_and_snippets() {
        let request = LanguageQueryRequest {
            path: "/workspace/Index.ets".to_string(),
            line: 1,
            column: 11,
            content: Some("service.pr".to_string()),
        };
        let items = vec![
            item("private", "keyword"),
            item("build method", "snippet"),
            item("build", "method"),
            item("profile", "property"),
            item("print()", "method"),
        ];
        let merged = merge_completion_sources(&request, items, Vec::new());
        assert_eq!(
            merged
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["profile", "print()"]
        );
    }

    #[test]
    fn semantic_generation_does_not_claim_the_index_generation() {
        let semantic = broker_envelope(
            vec!["item"],
            readiness(12),
            21,
            Some(9),
            "semantic+index",
            None,
            None,
            Vec::new(),
        );
        assert_eq!(semantic.target_generation, Some(9));
        assert!(!semantic.fallback_used);

        let indexed = broker_envelope(
            vec!["item"],
            readiness(12),
            22,
            Some(9),
            "index",
            None,
            Some("semantic unavailable".to_string()),
            Vec::new(),
        );
        assert_eq!(indexed.target_generation, Some(12));
        assert!(indexed.fallback_used);
        assert!(indexed
            .explain
            .iter()
            .any(|entry| entry == "semanticError:semantic unavailable"));
    }

    fn item(label: &str, kind: &str) -> CompletionItem {
        CompletionItem {
            label: label.to_string(),
            detail: String::new(),
            kind: kind.to_string(),
            insert_text: None,
            filter_text: None,
            sort_text: None,
            source: None,
            documentation: None,
            replacement_range: None,
            commit_characters: Vec::new(),
            definition_target: None,
            additional_text_edits: Vec::new(),
            data: None,
        }
    }

    fn readiness(generation: u64) -> WorkspaceIndexReadiness {
        WorkspaceIndexReadiness {
            root_path: "/workspace".to_string(),
            requested_generation: generation,
            served_generation: Some(generation),
            state: WorkspaceIndexReadinessState::Ready,
            reason: None,
            retryable: false,
        }
    }
}
