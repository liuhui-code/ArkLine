use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::language::{DefinitionCandidate, DefinitionTarget, LanguageQueryRequest};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceIndexState,
    WorkspaceIndexStatus, WorkspaceSearchCandidate, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_definition_reference_service::query_reference_definition_candidates;
use crate::services::workspace_index_entity_query_service::{
    query_workspace_entities, query_workspace_file_symbols, WorkspaceEntityQueryScope,
};
use crate::services::workspace_index_readiness_service::readiness_for_query;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_text_candidate_service::text_search_candidates;
use crate::services::workspace_symbol_resolution_query_service::{
    query_resolved_symbol_by_id, query_resolved_symbols_by_name_and_path,
};
use crate::services::workspace_text_search_service::search_workspace_text as search_filesystem_text;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexQueryScope {
    All,
    Files,
    Classes,
    Symbols,
    Apis,
    Text,
}

pub fn query_workspace_quick_open(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let mut candidates =
        query_workspace_entities(root_path, query, WorkspaceEntityQueryScope::Files, limit)?;
    if candidates.is_empty() {
        candidates = index_runtime.query_quick_open(root_path, query, limit)?;
    }
    normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
    Ok(candidates)
}

pub fn query_workspace_search_everywhere(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    query_workspace_candidates(
        index_runtime,
        root_path,
        query,
        WorkspaceIndexQueryScope::All,
        limit,
    )
}

pub fn query_workspace_candidates(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    if scope == WorkspaceIndexQueryScope::Text {
        return text_search_candidates(index_runtime, root_path, query, limit);
    }
    let entity_scope = match scope {
        WorkspaceIndexQueryScope::All => WorkspaceEntityQueryScope::All,
        WorkspaceIndexQueryScope::Files => WorkspaceEntityQueryScope::Files,
        WorkspaceIndexQueryScope::Classes => WorkspaceEntityQueryScope::Classes,
        WorkspaceIndexQueryScope::Symbols => WorkspaceEntityQueryScope::Symbols,
        WorkspaceIndexQueryScope::Apis => WorkspaceEntityQueryScope::Apis,
        WorkspaceIndexQueryScope::Text => unreachable!("text scope is handled above"),
    };
    let mut candidates = query_workspace_entities(root_path, query, entity_scope, limit)?;
    if candidates.is_empty() && scope == WorkspaceIndexQueryScope::All {
        candidates = index_runtime.query_search_everywhere(root_path, query, limit)?;
        normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
        return Ok(candidates);
    }
    crate::services::workspace_search_ranking_service::sort_search_everywhere_candidates(
        &mut candidates,
        limit,
    );
    normalize_candidate_paths_for_filesystem(root_path, &mut candidates);
    Ok(candidates)
}

#[allow(dead_code)] pub fn query_workspace_candidates_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    scope: WorkspaceIndexQueryScope,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let items = query_workspace_candidates(index_runtime, root_path, query, scope, limit)?;
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(), next_cursor: None,
    })
}

pub fn query_workspace_file_symbols_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<WorkspaceSearchCandidate>, String> {
    let mut items = query_workspace_file_symbols(root_path, file_path, query, limit)?;
    normalize_candidate_paths_for_filesystem(root_path, &mut items);
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(), next_cursor: None,
    })
}

pub fn query_definition_candidates_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    semantic_target: Option<DefinitionTarget>,
    semantic_candidates: Vec<DefinitionCandidate>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    let mut items = Vec::new();
    if let Some(target) = semantic_target {
        items.push(candidate_from_target(target, "Language service definition"));
    }
    items.extend(semantic_candidates);
    if items.is_empty() {
        items.extend(query_index_definition_candidates(root_path, request)?);
    }
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(), next_cursor: None,
    })
}

pub fn search_workspace_text(
    index_runtime: &WorkspaceIndexRuntime,
    request: WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    if should_use_indexed_text_search(&request) {
        return search_indexed_workspace_content(&request);
    }

    let index_state = index_runtime.get_index_state(&request.root_path)?;
    Ok(search_filesystem_text(&request, &index_state.file_paths))
}

pub(crate) fn readiness_for_index_state(state: &WorkspaceIndexState) -> WorkspaceIndexReadiness {
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

fn should_use_indexed_text_search(request: &WorkspaceTextSearchRequest) -> bool {
    let query = request.query.trim();
    !query.is_empty() && !query.starts_with('/') && !request.options.whole_word
}

fn query_index_definition_candidates(
    root_path: &str,
    request: &LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    let reference_candidates = query_reference_definition_candidates(root_path, request)?;
    if !reference_candidates.is_empty() {
        return Ok(reference_candidates);
    }
    let Some(symbol) = symbol_at_position(request) else {
        return Ok(Vec::new());
    };
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(&request.path);
    let mut candidates = Vec::new();
    candidates.extend(query_resolved_definition_candidates(
        root_path, &path_key, &symbol,
    )?);
    candidates.extend(query_import_definition_candidates(
        &connection,
        &root_key,
        &path_key,
        &symbol,
    )?);
    candidates.extend(query_sdk_definition_candidates(root_path, &symbol)?);
    candidates.extend(query_same_file_definition_candidates(
        &connection,
        &root_key,
        &path_key,
        &symbol,
    )?);
    dedupe_definition_candidates(&mut candidates);
    Ok(candidates)
}

fn query_resolved_definition_candidates(
    root_path: &str,
    path_key: &str,
    symbol: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    let aliases = query_resolved_symbols_by_name_and_path(root_path, symbol, path_key, 8)?;
    let mut candidates = Vec::new();
    for alias in aliases {
        let Some(target_id) = alias.target_symbol_id else {
            continue;
        };
        let Some(target) = query_resolved_symbol_by_id(root_path, &target_id)? else {
            continue;
        };
        candidates.push(DefinitionCandidate {
            path: denormalize_index_path(&target.path),
            line: u32::try_from(target.line).unwrap_or_default(),
            column: u32::try_from(target.column).unwrap_or_default(),
            preview: target
                .signature
                .unwrap_or_else(|| target.qualified_name.clone()),
        });
    }
    Ok(candidates)
}

fn query_import_definition_candidates(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
    symbol: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    let import = connection
        .query_row(
            "select imported_name
             from workspace_stub_imports
             where root_path = ?1 and path = ?2 and local_name = ?3
             order by line, column
             limit 1",
            params![root_key, path_key, symbol],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(imported_name) = import else {
        return Ok(Vec::new());
    };
    let target_paths = query_dependency_targets(connection, root_key, path_key)?;
    let target_names = if imported_name.as_deref() == Some("default") {
        query_default_export_local_names(connection, root_key, &target_paths)?
    } else {
        vec![imported_name.unwrap_or_else(|| symbol.to_string())]
    };
    query_stub_declarations(connection, root_key, &target_paths, &target_names)
}

fn query_dependency_targets(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select distinct to_path
             from workspace_dependency_edges
             where root_path = ?1 and from_path = ?2
             order by to_path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, path_key], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn query_default_export_local_names(
    connection: &Connection,
    root_key: &str,
    target_paths: &[String],
) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for path in target_paths {
        let mut statement = connection
            .prepare(
                "select local_name
                 from workspace_stub_exports
                 where root_path = ?1 and path = ?2 and exported_name = 'default'
                 order by line, column",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![root_key, path], |row| {
                row.get::<_, Option<String>>(0)
            })
            .map_err(|error| error.to_string())?;
        names.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
                .into_iter()
                .flatten(),
        );
    }
    Ok(names)
}

fn query_stub_declarations(
    connection: &Connection,
    root_key: &str,
    target_paths: &[String],
    target_names: &[String],
) -> Result<Vec<DefinitionCandidate>, String> {
    let mut candidates = Vec::new();
    for path in target_paths {
        for name in target_names {
            let mut statement = connection
                .prepare(
                    "select path, line, column, signature
                     from workspace_stub_declarations
                     where root_path = ?1 and path = ?2 and name = ?3
                     order by line, column",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(params![root_key, path, name], |row| {
                    let line: i64 = row.get(1)?;
                    let column: i64 = row.get(2)?;
                    Ok(DefinitionCandidate {
                        path: denormalize_index_path(&row.get::<_, String>(0)?),
                        line: u32::try_from(line).unwrap_or_default(),
                        column: u32::try_from(column).unwrap_or_default(),
                        preview: row.get(3)?,
                    })
                })
                .map_err(|error| error.to_string())?;
            candidates.extend(
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?,
            );
        }
    }
    Ok(candidates)
}

fn query_sdk_definition_candidates(
    root_path: &str,
    symbol: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    let matches = crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols(
        root_path, symbol, 8,
    )?;
    Ok(matches
        .into_iter()
        .filter(|candidate| candidate.source == "api" && candidate.title == symbol)
        .filter_map(|candidate| {
            Some(DefinitionCandidate {
                path: denormalize_index_path(&candidate.path?),
                line: u32::try_from(candidate.line?).ok()?,
                column: u32::try_from(candidate.column?).ok()?,
                preview: candidate.subtitle,
            })
        })
        .collect())
}

fn query_same_file_definition_candidates(
    connection: &Connection,
    root_key: &str,
    path_key: &str,
    symbol: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    query_stub_declarations(
        connection,
        root_key,
        &[path_key.to_string()],
        &[symbol.to_string()],
    )
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

fn is_identifier_byte(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}

fn candidate_from_target(target: DefinitionTarget, preview: &str) -> DefinitionCandidate {
    DefinitionCandidate {
        path: target.path,
        line: target.line,
        column: target.column,
        preview: preview.to_string(),
    }
}

fn dedupe_definition_candidates(candidates: &mut Vec<DefinitionCandidate>) {
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|candidate| {
        seen.insert((candidate.path.clone(), candidate.line, candidate.column))
    });
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Err(format!(
            "Workspace index does not exist: {}",
            cache_path.display()
        ));
    }
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_candidate_paths_for_filesystem(
    root_path: &str,
    candidates: &mut [WorkspaceSearchCandidate],
) {
    for candidate in candidates {
        if let Some(path) = candidate.path.as_mut() {
            *path = to_filesystem_path(root_path, path);
        }
    }
}

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        indexed_path.to_string()
    } else if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}
