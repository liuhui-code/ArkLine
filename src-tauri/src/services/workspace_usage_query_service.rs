use std::fs;

use crate::models::language::{LanguageQueryRequest, UsageResult};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceIndexState, WorkspaceIndexStatus,
};
use crate::services::workspace_index_readiness_service::readiness_for_query;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_reference_index_service::{
    query_reference_at_position, query_references_by_symbol_id,
};
use crate::services::workspace_symbol_resolution_query_service::{
    query_resolved_symbols_by_name, query_resolved_symbols_by_name_and_path,
};

pub fn query_usages_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<UsageResult>, String> {
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    let Some(symbol_id) = target_symbol_id_at_position(root_path, request)? else {
        return Ok(WorkspaceIndexQueryEnvelope {
            items: Vec::new(),
            readiness,
        });
    };
    let references = query_references_by_symbol_id(root_path, &symbol_id, limit)?;
    let items = references
        .into_iter()
        .filter(|reference| reference.kind != "declaration")
        .map(|reference| UsageResult {
            path: denormalize_index_path(&reference.path),
            line: u32::try_from(reference.line).unwrap_or_default(),
            column: u32::try_from(reference.column).unwrap_or_default(),
            preview: preview_line(&reference.path, reference.line),
            kind: reference.kind,
            confidence: reference.confidence,
        })
        .collect();
    Ok(WorkspaceIndexQueryEnvelope { items, readiness })
}

fn target_symbol_id_at_position(
    root_path: &str,
    request: &LanguageQueryRequest,
) -> Result<Option<String>, String> {
    if let Some(reference) =
        query_reference_at_position(root_path, &request.path, request.line, request.column)?
    {
        if let Some(symbol_id) = reference.symbol_id {
            return Ok(Some(symbol_id));
        }
    }
    let Some(symbol) = symbol_at_position(request) else {
        return Ok(None);
    };
    let path_key = normalize_index_path(&request.path);
    let same_file = query_resolved_symbols_by_name_and_path(root_path, &symbol, &path_key, 8)?;
    if let Some(row) = same_file.first() {
        return Ok(Some(
            row.target_symbol_id
                .clone()
                .unwrap_or_else(|| row.symbol_id.clone()),
        ));
    }
    let global = query_resolved_symbols_by_name(root_path, &symbol, 1)?;
    Ok(global.into_iter().next().map(|row| row.symbol_id))
}

fn symbol_at_position(request: &LanguageQueryRequest) -> Option<String> {
    let content = request.content.as_ref()?;
    let line = content
        .lines()
        .nth(request.line.saturating_sub(1) as usize)?;
    let bytes = line.as_bytes();
    let mut index = request.column.saturating_sub(1) as usize;
    if index >= bytes.len() {
        index = bytes.len().saturating_sub(1);
    }
    while index < bytes.len() && !is_identifier_byte(bytes[index]) {
        index = index.saturating_add(1);
    }
    if index >= bytes.len() || !is_identifier_byte(bytes[index]) {
        return None;
    }
    let mut start = index;
    while start > 0 && is_identifier_byte(bytes[start - 1]) {
        start -= 1;
    }
    let mut end = index;
    while end < bytes.len() && is_identifier_byte(bytes[end]) {
        end += 1;
    }
    line.get(start..end).map(|value| value.to_string())
}

fn readiness_for_index_state(state: &WorkspaceIndexState) -> WorkspaceIndexReadiness {
    let root_path = state.root_path.as_deref().unwrap_or_default();
    let served_generation = state.indexed_at.and_then(|value| u64::try_from(value).ok());
    let requested_generation = match state.status {
        WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => {
            served_generation.unwrap_or_default().saturating_add(1)
        }
        _ => served_generation.unwrap_or_default(),
    };
    let partial_reason = match state.status {
        WorkspaceIndexStatus::Partial => {
            state.partial_reason.as_deref().or(Some("Index is partial"))
        }
        _ => None,
    };
    readiness_for_query(
        root_path,
        requested_generation,
        served_generation,
        partial_reason,
    )
}

fn preview_line(path: &str, line: i64) -> String {
    fs::read_to_string(denormalize_index_path(path))
        .ok()
        .and_then(|content| {
            content
                .lines()
                .nth(line.saturating_sub(1) as usize)
                .map(|line| line.trim().to_string())
        })
        .unwrap_or_default()
}

fn is_identifier_byte(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}
