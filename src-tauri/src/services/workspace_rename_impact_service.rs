use std::fs;

use crate::models::language::{LanguageQueryRequest, RenameImpactItem, RenameImpactResult};
use crate::services::workspace_reference_index_service::{
    query_reference_at_position, query_references_by_symbol_id,
};
use crate::services::workspace_reference_query_service::WorkspaceSymbolReferenceRow;
use crate::services::workspace_symbol_identity_merge_service::query_merged_symbol_ids;
use crate::services::workspace_symbol_resolution_query_service::{
    query_resolved_symbol_by_id, query_resolved_symbols_by_name,
    query_resolved_symbols_by_name_and_path,
};

pub fn query_rename_impact(
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<Option<RenameImpactResult>, String> {
    let Some(symbol_id) = target_symbol_id_at_position(root_path, request)? else {
        return Ok(None);
    };
    let references = query_references_for_merged_symbols(root_path, &symbol_id, limit)?;
    let declaration = references
        .iter()
        .find(|reference| reference.kind == "declaration")
        .map(reference_to_impact_item);
    let current_name = current_symbol_name(root_path, &symbol_id, &references)?;
    let references = references
        .into_iter()
        .filter(|reference| reference.kind != "declaration")
        .map(|reference| reference_to_impact_item(&reference))
        .collect();
    Ok(Some(RenameImpactResult {
        symbol_id,
        current_name,
        declaration,
        references,
    }))
}

fn query_references_for_merged_symbols(
    root_path: &str,
    symbol_id: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSymbolReferenceRow>, String> {
    let mut references = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for merged_id in query_merged_symbol_ids(root_path, symbol_id)? {
        for reference in query_references_by_symbol_id(root_path, &merged_id, limit)? {
            if seen.insert(reference.reference_id.clone()) {
                references.push(reference);
            }
        }
    }
    references.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.column.cmp(&right.column))
    });
    references.truncate(limit);
    Ok(references)
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

fn current_symbol_name(
    root_path: &str,
    symbol_id: &str,
    references: &[WorkspaceSymbolReferenceRow],
) -> Result<String, String> {
    if let Some(symbol) = query_resolved_symbol_by_id(root_path, symbol_id)? {
        return Ok(symbol.name);
    }
    Ok(references
        .iter()
        .find(|reference| reference.kind == "declaration")
        .or_else(|| references.first())
        .map(|reference| reference.name.clone())
        .unwrap_or_default())
}

fn reference_to_impact_item(reference: &WorkspaceSymbolReferenceRow) -> RenameImpactItem {
    RenameImpactItem {
        path: denormalize_index_path(&reference.path),
        line: u32::try_from(reference.line).unwrap_or_default(),
        column: u32::try_from(reference.column).unwrap_or_default(),
        end_line: u32::try_from(reference.end_line).unwrap_or_default(),
        end_column: u32::try_from(reference.end_column).unwrap_or_default(),
        name: reference.name.clone(),
        kind: reference.kind.clone(),
        confidence: reference.confidence.clone(),
        preview: preview_line(&reference.path, reference.line),
    }
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
