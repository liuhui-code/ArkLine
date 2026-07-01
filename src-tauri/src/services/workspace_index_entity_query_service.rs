use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::{WorkspaceIndexedSymbol, WorkspaceSearchCandidate};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_index_service::query_workspace_sdk_symbols;
use crate::services::workspace_search_ranking_service::{
    build_file_candidates, sort_search_everywhere_candidates,
};
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;
use crate::services::workspace_symbol_index_service::query_index_symbols;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceEntityQueryScope {
    All,
    Files,
    Classes,
    Symbols,
    Apis,
}

pub fn query_workspace_entities(
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

pub fn query_workspace_file_symbols(
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
    let symbols = load_file_stub_symbols(&connection, &root_key, &normalized_file_path)
        .and_then(|symbols| {
            if symbols.is_empty() {
                load_file_symbol_entities(&connection, &root_key, &normalized_file_path)
                    .and_then(|symbols| {
                        if symbols.is_empty() {
                            load_legacy_file_symbols(&connection, &root_key, &normalized_file_path)
                        } else {
                            Ok(symbols)
                        }
                    })
            } else {
                Ok(symbols)
            }
        })?;
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

fn load_stub_symbols(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select declaration.kind, declaration.name, declaration.path, declaration.line,
                declaration.column, declaration.container
             from workspace_stub_declarations declaration
             join workspace_stub_files file
                on file.root_path = declaration.root_path and file.path = declaration.path
             where declaration.root_path = ?1 and file.parser_version = ?2
             order by declaration.kind, declaration.qualified_name, declaration.path,
                declaration.line, declaration.column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, ARKTS_STUB_PARSER_VERSION], |row| {
            row_to_stub_symbol(row)
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_symbol_entities(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container
             from workspace_symbol_entities
             where root_path = ?1
             order by source, qualified_name, path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let line: i64 = row.get(4)?;
            let column: i64 = row.get(5)?;
            Ok(WorkspaceIndexedSymbol {
                source: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
                container: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_file_stub_symbols(
    connection: &Connection,
    root_key: &str,
    file_path: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select declaration.kind, declaration.name, declaration.path, declaration.line,
                declaration.column, declaration.container
             from workspace_stub_declarations declaration
             join workspace_stub_files file
                on file.root_path = declaration.root_path and file.path = declaration.path
             where declaration.root_path = ?1 and declaration.path = ?2 and file.parser_version = ?3
             order by declaration.line, declaration.column, declaration.qualified_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, file_path, ARKTS_STUB_PARSER_VERSION],
            |row| row_to_stub_symbol(row),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_file_symbol_entities(
    connection: &Connection,
    root_key: &str,
    file_path: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container
             from workspace_symbol_entities
             where root_path = ?1 and path = ?2
             order by line, column, qualified_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, file_path], |row| row_to_symbol(row))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_legacy_symbols(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container
             from workspace_symbols
             where root_path = ?1
             order by source, name, path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let line: i64 = row.get(4)?;
            let column: i64 = row.get(5)?;
            Ok(WorkspaceIndexedSymbol {
                source: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
                container: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_legacy_file_symbols(
    connection: &Connection,
    root_key: &str,
    file_path: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container
             from workspace_symbols
             where root_path = ?1 and path = ?2
             order by line, column, name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, file_path], |row| row_to_symbol(row))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn row_to_stub_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceIndexedSymbol> {
    let kind: String = row.get(0)?;
    let line: i64 = row.get(3)?;
    let column: i64 = row.get(4)?;
    Ok(WorkspaceIndexedSymbol {
        source: stub_source_for_kind(&kind).to_string(),
        kind,
        name: row.get(1)?,
        path: row.get(2)?,
        line: usize::try_from(line).unwrap_or_default(),
        column: usize::try_from(column).unwrap_or_default(),
        container: row.get(5)?,
    })
}

fn row_to_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceIndexedSymbol> {
    let line: i64 = row.get(4)?;
    let column: i64 = row.get(5)?;
    Ok(WorkspaceIndexedSymbol {
        source: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        line: usize::try_from(line).unwrap_or_default(),
        column: usize::try_from(column).unwrap_or_default(),
        container: row.get(6)?,
    })
}

fn symbol_to_candidate(
    symbol: WorkspaceIndexedSymbol,
    freshness: &str,
    score: f64,
) -> WorkspaceSearchCandidate {
    WorkspaceSearchCandidate {
        id: format!(
            "{}:{}:{}:{}",
            symbol.source, symbol.path, symbol.line, symbol.column
        ),
        source: symbol.source,
        kind: symbol.kind,
        title: symbol.name,
        subtitle: symbol
            .container
            .as_ref()
            .map(|container| format!("{container} · {}:{}", symbol.path, symbol.line))
            .unwrap_or_else(|| format!("{}:{}", symbol.path, symbol.line)),
        path: Some(symbol.path),
        line: Some(symbol.line),
        column: Some(symbol.column),
        score,
        freshness: freshness.to_string(),
    }
}

fn load_index_freshness(connection: &Connection, root_key: &str) -> Result<String, String> {
    let status = connection
        .query_row(
            "select status
             from workspace_index_metadata
             where root_path = ?1",
            params![root_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(match status.as_deref() {
        Some("partial") => "partial",
        Some("stale" | "failed") => "stale",
        _ => "ready",
    }
    .to_string())
}

fn open_existing_index_store(root_path: &str) -> Result<Option<Connection>, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Ok(None);
    }
    Connection::open(cache_path)
        .map(Some)
        .map_err(|error| error.to_string())
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

fn stub_source_for_kind(kind: &str) -> &str {
    if matches!(kind, "struct" | "class" | "interface" | "enum" | "type") {
        "class"
    } else {
        "symbol"
    }
}
