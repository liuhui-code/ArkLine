use crate::models::language::{CompletionItem, DefinitionCandidate, UsageResult};
use crate::models::workspace::{WorkspaceIndexQueryEnvelope, WorkspaceSearchCandidate};
use crate::services::workspace_index_facade_service::{
    WorkspaceIndexFacadeEnvelope, WorkspaceIndexFacadeItem,
};

pub(crate) fn search_query_envelope(
    envelope: WorkspaceIndexFacadeEnvelope,
) -> WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate> {
    typed_query_envelope(envelope, search_item)
}

pub(crate) fn definition_query_envelope(
    envelope: WorkspaceIndexFacadeEnvelope,
) -> WorkspaceIndexQueryEnvelope<DefinitionCandidate> {
    typed_query_envelope(envelope, definition_item)
}

pub(crate) fn usage_query_envelope(
    envelope: WorkspaceIndexFacadeEnvelope,
) -> WorkspaceIndexQueryEnvelope<UsageResult> {
    typed_query_envelope(envelope, usage_item)
}

pub(crate) fn completion_query_envelope(
    envelope: WorkspaceIndexFacadeEnvelope,
) -> WorkspaceIndexQueryEnvelope<CompletionItem> {
    typed_query_envelope(envelope, completion_item)
}

fn typed_query_envelope<T>(
    envelope: WorkspaceIndexFacadeEnvelope,
    map_item: fn(WorkspaceIndexFacadeItem) -> Option<T>,
) -> WorkspaceIndexQueryEnvelope<T> {
    let WorkspaceIndexFacadeEnvelope {
        items,
        readiness,
        explain,
        next_cursor,
        ..
    } = envelope;
    WorkspaceIndexQueryEnvelope {
        items: items.into_iter().filter_map(map_item).collect(),
        readiness,
        explain,
        next_cursor,
    }
}

fn search_item(item: WorkspaceIndexFacadeItem) -> Option<WorkspaceSearchCandidate> {
    match item {
        WorkspaceIndexFacadeItem::Search(candidate) => Some(candidate),
        _ => None,
    }
}

fn definition_item(item: WorkspaceIndexFacadeItem) -> Option<DefinitionCandidate> {
    match item {
        WorkspaceIndexFacadeItem::Definition(candidate) => Some(candidate),
        _ => None,
    }
}

fn usage_item(item: WorkspaceIndexFacadeItem) -> Option<UsageResult> {
    match item {
        WorkspaceIndexFacadeItem::Usage(usage) => Some(usage),
        _ => None,
    }
}

fn completion_item(item: WorkspaceIndexFacadeItem) -> Option<CompletionItem> {
    match item {
        WorkspaceIndexFacadeItem::Completion(completion) => Some(completion),
        _ => None,
    }
}
