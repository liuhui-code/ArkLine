use std::fs;

use rusqlite::params;

use crate::models::language::{
    CallHierarchyEdge, CallHierarchyResult, LanguageQueryRequest, SymbolHierarchyNode,
    TypeHierarchyResult,
};
use crate::services::workspace_index_query_path_service::{normalize_index_path, open_index_store};
use crate::services::workspace_reference_index_service::{
    query_reference_at_position, query_references_by_symbol_id,
};
use crate::services::workspace_reference_query_service::WorkspaceSymbolReferenceRow;
use crate::services::workspace_symbol_identity_merge_service::query_merged_symbol_ids;
use crate::services::workspace_symbol_resolution_query_service::{
    query_resolved_symbol_by_id, query_resolved_symbols_by_name,
    query_resolved_symbols_by_name_and_path, WorkspaceResolvedSymbolRow,
};

pub fn query_call_hierarchy(
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<Option<CallHierarchyResult>, String> {
    let Some(symbol_id) = target_symbol_id_at_position(root_path, request)? else {
        return Ok(None);
    };
    let Some(target) = query_resolved_symbol_by_id(root_path, &symbol_id)? else {
        return Ok(None);
    };
    let merged_ids = query_merged_symbol_ids(root_path, &symbol_id)?;
    Ok(Some(CallHierarchyResult {
        target: symbol_to_node(&target),
        incoming: incoming_call_edges(root_path, &merged_ids, limit)?,
        outgoing: outgoing_call_edges(root_path, &target, &merged_ids, limit)?,
    }))
}

pub fn query_type_hierarchy(
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<Option<TypeHierarchyResult>, String> {
    let Some(symbol_id) = target_symbol_id_at_position(root_path, request)? else {
        return Ok(None);
    };
    let Some(target) = query_resolved_symbol_by_id(root_path, &symbol_id)? else {
        return Ok(None);
    };
    if !matches!(target.kind.as_str(), "class" | "interface") {
        return Ok(None);
    }
    let supertypes = target
        .signature
        .as_deref()
        .and_then(extends_type_name)
        .map(|name| query_resolved_symbols_by_name(root_path, name, limit))
        .transpose()?
        .unwrap_or_default()
        .into_iter()
        .filter(|symbol| matches!(symbol.kind.as_str(), "class" | "interface"))
        .map(|symbol| symbol_to_node(&symbol))
        .collect();
    let subtypes = query_project_subtypes(root_path, &target.name, limit)?
        .into_iter()
        .map(|symbol| symbol_to_node(&symbol))
        .collect();
    Ok(Some(TypeHierarchyResult {
        target: symbol_to_node(&target),
        supertypes,
        subtypes,
    }))
}

fn incoming_call_edges(
    root_path: &str,
    symbol_ids: &[String],
    limit: usize,
) -> Result<Vec<CallHierarchyEdge>, String> {
    let mut edges = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for symbol_id in symbol_ids {
        for reference in query_references_by_symbol_id(root_path, symbol_id, limit)? {
            if reference.kind == "declaration" || !seen.insert(reference.reference_id.clone()) {
                continue;
            }
            edges.push(reference_to_edge(reference, symbol_id));
        }
    }
    edges.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.column.cmp(&right.column))
    });
    edges.truncate(limit);
    Ok(edges)
}

fn outgoing_call_edges(
    root_path: &str,
    target: &WorkspaceResolvedSymbolRow,
    own_symbol_ids: &[String],
    limit: usize,
) -> Result<Vec<CallHierarchyEdge>, String> {
    let Some((start_line, end_line)) = body_line_range(&target.path, target.line) else {
        return Ok(Vec::new());
    };
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let own = own_symbol_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut statement = connection
        .prepare(
            "select path, reference_id, symbol_id, name, kind, container,
                    line, column, end_line, end_column, confidence
             from workspace_symbol_references
             where root_path = ?1
               and path = ?2
               and line >= ?3
               and line <= ?4
               and symbol_id is not null
               and kind != 'declaration'
             order by line, column
             limit ?5",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                root_key,
                target.path,
                start_line,
                end_line,
                i64::try_from(limit.clamp(1, 500)).unwrap_or(500)
            ],
            reference_from_row,
        )
        .map_err(|error| error.to_string())?;
    let references = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(references
        .into_iter()
        .filter(|reference| {
            reference
                .symbol_id
                .as_ref()
                .is_some_and(|symbol_id| !own.contains(symbol_id))
        })
        .map(|reference| {
            let symbol_id = reference.symbol_id.clone().unwrap_or_default();
            reference_to_edge(reference, &symbol_id)
        })
        .collect())
}

fn query_project_subtypes(
    root_path: &str,
    type_name: &str,
    limit: usize,
) -> Result<Vec<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let pattern = format!("%extends {type_name}%");
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and kind in ('class', 'interface')
               and signature like ?2
             order by path, line, column
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                root_key,
                pattern,
                i64::try_from(limit.clamp(1, 500)).unwrap_or(500)
            ],
            resolved_symbol_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
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
    Ok(query_resolved_symbols_by_name(root_path, &symbol, 1)?
        .into_iter()
        .next()
        .map(|row| row.symbol_id))
}

fn symbol_to_node(symbol: &WorkspaceResolvedSymbolRow) -> SymbolHierarchyNode {
    SymbolHierarchyNode {
        symbol_id: symbol.symbol_id.clone(),
        name: symbol.name.clone(),
        kind: symbol.kind.clone(),
        path: denormalize_index_path(&symbol.path),
        line: u32::try_from(symbol.line).unwrap_or_default(),
        column: u32::try_from(symbol.column).unwrap_or_default(),
        preview: symbol
            .signature
            .clone()
            .unwrap_or_else(|| symbol.qualified_name.clone()),
    }
}

fn reference_to_edge(
    reference: WorkspaceSymbolReferenceRow,
    fallback_id: &str,
) -> CallHierarchyEdge {
    CallHierarchyEdge {
        symbol_id: reference
            .symbol_id
            .unwrap_or_else(|| fallback_id.to_string()),
        name: reference.name,
        kind: reference.kind,
        path: denormalize_index_path(&reference.path),
        line: u32::try_from(reference.line).unwrap_or_default(),
        column: u32::try_from(reference.column).unwrap_or_default(),
        preview: preview_line(&reference.path, reference.line),
        confidence: reference.confidence,
    }
}

fn reference_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSymbolReferenceRow> {
    Ok(WorkspaceSymbolReferenceRow {
        path: row.get(0)?,
        reference_id: row.get(1)?,
        symbol_id: row.get(2)?,
        name: row.get(3)?,
        kind: row.get(4)?,
        container: row.get(5)?,
        line: row.get(6)?,
        column: row.get(7)?,
        end_line: row.get(8)?,
        end_column: row.get(9)?,
        confidence: row.get(10)?,
    })
}

fn resolved_symbol_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<WorkspaceResolvedSymbolRow> {
    Ok(WorkspaceResolvedSymbolRow {
        symbol_id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        qualified_name: row.get(3)?,
        kind: row.get(4)?,
        container: row.get(5)?,
        signature: row.get(6)?,
        visibility: row.get(7)?,
        target_symbol_id: row.get(8)?,
        source: row.get(9)?,
        line: row.get(10)?,
        column: row.get(11)?,
    })
}

fn body_line_range(path: &str, start_line: i64) -> Option<(i64, i64)> {
    let content = fs::read_to_string(denormalize_index_path(path)).ok()?;
    let mut depth = 0_i64;
    let mut started = false;
    for (index, line) in content
        .lines()
        .enumerate()
        .skip(start_line.saturating_sub(1) as usize)
    {
        for character in line.chars() {
            if character == '{' {
                depth += 1;
                started = true;
            } else if character == '}' && started {
                depth -= 1;
                if depth <= 0 {
                    return Some((start_line, index as i64 + 1));
                }
            }
        }
    }
    Some((start_line, start_line))
}

fn extends_type_name(signature: &str) -> Option<&str> {
    let after_extends = signature.split_once(" extends ")?.1.trim_start();
    let end = after_extends
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(after_extends.len());
    after_extends.get(..end).filter(|value| !value.is_empty())
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

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}
