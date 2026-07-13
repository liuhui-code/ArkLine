use rusqlite::params;

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_index_entity_store_service::{
    load_file_stub_symbols, load_file_symbol_entities, load_index_freshness,
    load_legacy_file_symbols, load_legacy_symbols, load_stub_symbols, load_symbol_entities,
    normalize_index_path, open_existing_index_store, symbol_to_candidate,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;
use crate::services::workspace_search_ranking_service::{
    build_file_candidates, sort_search_everywhere_candidates,
};
use crate::services::workspace_symbol_index_service::query_index_symbols;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceEntityQueryScope {
    All,
    Files,
    Classes,
    Symbols,
    Apis,
}

pub(crate) fn query_workspace_entities(
    root_path: &str,
    query: &str,
    scope: WorkspaceEntityQueryScope,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let mut candidates = match scope {
        WorkspaceEntityQueryScope::All => {
            let mut candidates = query_file_entities(root_path, query, limit)?;
            candidates.extend(query_symbol_entities(root_path, query, None, limit)?);
            candidates.extend(query_workspace_sdk_symbols(root_path, query, limit)?);
            candidates
        }
        WorkspaceEntityQueryScope::Files => query_file_entities(root_path, query, limit)?,
        WorkspaceEntityQueryScope::Classes => {
            query_symbol_entities(root_path, query, Some("class"), limit)?
        }
        WorkspaceEntityQueryScope::Symbols => {
            query_symbol_entities(root_path, query, Some("symbol"), limit)?
        }
        WorkspaceEntityQueryScope::Apis => query_workspace_sdk_symbols(root_path, query, limit)?,
    };
    sort_search_everywhere_candidates(&mut candidates, limit);
    Ok(candidates)
}

pub(crate) fn query_workspace_file_symbols(
    root_path: &str,
    file_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let Some(connection) = open_existing_index_store(root_path)? else {
        return Ok(Vec::new());
    };
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let normalized_file_path = normalize_index_path(file_path);
    let freshness = load_index_freshness(&connection, &root_key)?;
    let symbols = load_file_stub_symbols(&connection, &root_key, &normalized_file_path).and_then(
        |symbols| {
            if symbols.is_empty() {
                load_file_symbol_entities(&connection, &root_key, &normalized_file_path).and_then(
                    |symbols| {
                        if symbols.is_empty() {
                            load_legacy_file_symbols(&connection, &root_key, &normalized_file_path)
                        } else {
                            Ok(symbols)
                        }
                    },
                )
            } else {
                Ok(symbols)
            }
        },
    )?;
    let mut candidates = if query.trim().is_empty() {
        symbols
            .into_iter()
            .map(|symbol| symbol_to_candidate(symbol, &freshness, 0.0))
            .collect::<Vec<_>>()
    } else {
        query_index_symbols(&symbols, query, symbols.len().max(limit))
            .into_iter()
            .map(|mut candidate| {
                candidate.freshness = freshness.clone();
                candidate
            })
            .collect::<Vec<_>>()
    };
    candidates.sort_by(|left, right| {
        left.line
            .cmp(&right.line)
            .then_with(|| left.column.cmp(&right.column))
            .then_with(|| left.title.cmp(&right.title))
    });
    candidates.truncate(limit);
    Ok(candidates)
}

fn query_file_entities(
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let Some(connection) = open_existing_index_store(root_path)? else {
        return Ok(Vec::new());
    };
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let freshness = load_index_freshness(&connection, &root_key)?;
    let mut statement = connection
        .prepare(
            "select path
             from workspace_files
             where root_path = ?1
             order by path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let paths = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(build_file_candidates(&paths, query, limit, &freshness))
}

fn query_symbol_entities(
    root_path: &str,
    query: &str,
    source: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let Some(connection) = open_existing_index_store(root_path)? else {
        return Ok(Vec::new());
    };
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let freshness = load_index_freshness(&connection, &root_key)?;
    let symbols = load_stub_symbols(&connection, &root_key).and_then(|symbols| {
        if symbols.is_empty() {
            load_symbol_entities(&connection, &root_key).and_then(|symbols| {
                if symbols.is_empty() {
                    load_legacy_symbols(&connection, &root_key)
                } else {
                    Ok(symbols)
                }
            })
        } else {
            Ok(symbols)
        }
    })?;
    let candidates = query_index_symbols(&symbols, query, symbols.len().max(limit))
        .into_iter()
        .filter(|candidate| source.is_none_or(|value| candidate.source == value))
        .map(|mut candidate| {
            candidate.freshness = freshness.clone();
            candidate
        })
        .take(limit)
        .collect();
    Ok(candidates)
}
