use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_parser_service::{collect_sdk_symbols, WorkspaceSdkSymbol};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSdkIndexSummary {
    pub symbol_count: usize,
}

pub fn index_workspace_sdk_symbols(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
) -> Result<WorkspaceSdkIndexSummary, String> {
    if !Path::new(root_path).is_dir() || !Path::new(sdk_path).is_dir() {
        return Ok(WorkspaceSdkIndexSummary { symbol_count: 0 });
    }

    let mut connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let sdk_key = normalize_index_path(sdk_path);
    let symbols = collect_sdk_symbols(sdk_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "delete from workspace_sdk_symbols
             where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
            params![root_key, sdk_key, sdk_version],
        )
        .map_err(|error| error.to_string())?;
    for symbol in &symbols {
        transaction
            .execute(
                "insert into workspace_sdk_symbols (
                    root_path, sdk_path, sdk_version, source, kind, name,
                    path, line, column, container, signature
                 ) values (?1, ?2, ?3, 'api', ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    root_key,
                    sdk_key,
                    sdk_version,
                    symbol.kind,
                    symbol.name,
                    symbol.path,
                    symbol.line as i64,
                    symbol.column as i64,
                    symbol.container,
                    symbol.signature,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    record_active_sdk_index(&transaction, &root_key, &sdk_key, sdk_version)?;
    prune_superseded_sdk_symbols(&transaction, &root_key, &sdk_key, sdk_version)?;
    transaction.commit().map_err(|error| error.to_string())?;

    Ok(WorkspaceSdkIndexSummary {
        symbol_count: symbols.len(),
    })
}

pub fn query_workspace_sdk_symbols(
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let query_terms = parse_sdk_query_terms(query);
    if query_terms.name_query.is_empty() {
        return Ok(Vec::new());
    }

    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let pattern = format!("%{}%", escape_like_pattern(&query_terms.name_query));
    let fetch_limit = limit.saturating_mul(8).max(limit);
    let mut statement = connection
        .prepare(
            "select symbol.kind, symbol.name, symbol.path, symbol.line, symbol.column,
                    symbol.container, symbol.signature
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1 and lower(symbol.name) like ?2 escape '\\'
             order by symbol.name, symbol.kind, symbol.path, symbol.line
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, pattern, fetch_limit as i64], |row| {
            let line: i64 = row.get(3)?;
            let column: i64 = row.get(4)?;
            Ok(WorkspaceSdkSymbol {
                kind: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
                container: row.get(5)?,
                signature: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut candidates = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|symbol| to_candidate(symbol, &query_terms))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.subtitle.cmp(&right.subtitle))
    });
    candidates.truncate(limit);
    Ok(candidates)
}

fn record_active_sdk_index(
    transaction: &Transaction<'_>,
    root_key: &str,
    sdk_key: &str,
    sdk_version: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "insert into workspace_sdk_index_metadata (
                root_path, sdk_path, sdk_version, indexed_at
             ) values (?1, ?2, ?3, strftime('%s','now') * 1000)
             on conflict(root_path) do update set
                sdk_path = excluded.sdk_path,
                sdk_version = excluded.sdk_version,
                indexed_at = excluded.indexed_at",
            params![root_key, sdk_key, sdk_version],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn prune_superseded_sdk_symbols(
    transaction: &Transaction<'_>,
    root_key: &str,
    sdk_key: &str,
    sdk_version: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "delete from workspace_sdk_symbols
             where root_path = ?1 and (sdk_path != ?2 or sdk_version != ?3)",
            params![root_key, sdk_key, sdk_version],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn to_candidate(
    symbol: WorkspaceSdkSymbol,
    query_terms: &SdkQueryTerms,
) -> Option<WorkspaceSearchCandidate> {
    let score = score_sdk_symbol(&symbol, query_terms)?;
    Some(WorkspaceSearchCandidate {
        id: format!("api:{}:{}:{}", symbol.path, symbol.line, symbol.column),
        source: "api".to_string(),
        kind: symbol.kind,
        title: symbol.name,
        subtitle: symbol
            .container
            .map(|container| format!("{container} · {}", symbol.path))
            .unwrap_or(symbol.path.clone()),
        path: Some(symbol.path),
        line: Some(symbol.line),
        column: Some(symbol.column),
        score,
        freshness: "ready".to_string(),
    })
}

fn score_sdk_symbol(symbol: &WorkspaceSdkSymbol, query_terms: &SdkQueryTerms) -> Option<f64> {
    if !query_terms
        .qualifiers
        .iter()
        .all(|term| sdk_symbol_matches_term(symbol, term))
    {
        return None;
    }

    let lowered = symbol.name.to_lowercase();
    let mut score = if lowered == query_terms.name_query {
        120.0
    } else if lowered.starts_with(&query_terms.name_query) {
        95.0
    } else if lowered.contains(&query_terms.name_query) {
        70.0
    } else {
        return None;
    };

    if query_terms.qualifiers.iter().any(|term| {
        symbol
            .container
            .as_ref()
            .is_some_and(|container| container.to_lowercase() == *term)
    }) {
        score += 30.0;
    }

    Some(score)
}

fn sdk_symbol_matches_term(symbol: &WorkspaceSdkSymbol, term: &str) -> bool {
    symbol.name.to_lowercase().contains(term)
        || symbol
            .container
            .as_ref()
            .is_some_and(|container| container.to_lowercase().contains(term))
}

struct SdkQueryTerms {
    qualifiers: Vec<String>,
    name_query: String,
}

fn parse_sdk_query_terms(query: &str) -> SdkQueryTerms {
    let mut terms = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    let name_query = terms.pop().unwrap_or_default();
    SdkQueryTerms {
        qualifiers: terms,
        name_query,
    }
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SDK index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
