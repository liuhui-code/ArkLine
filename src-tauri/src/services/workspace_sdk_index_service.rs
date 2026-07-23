use std::path::Path;

use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, with_workspace_index_transaction,
    with_workspace_index_writer,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_binding_service::{mark_sdk_binding_ready, record_sdk_binding};
use crate::services::workspace_sdk_parser_service::{
    collect_sdk_symbols, collect_sdk_symbols_from_files, WorkspaceSdkSymbol,
};
use crate::services::workspace_sdk_shared_bridge_service::{
    maintain_active_shared_sdk_store, mark_active_sdk_artifact_ready,
    prepare_sdk_artifact_identity, publish_complete_sdk_artifact,
    publish_prepared_shared_sdk_chunk, query_shared_sdk_name_candidates,
    record_active_shared_sdk_reference,
};
use crate::services::workspace_search_ranking_service::lexical_match_score;
use crate::services::workspace_shared_sdk_artifact_service::SharedSdkArtifactIdentity;
use crate::services::workspace_symbol_identity_service::sdk_symbol_id;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSdkIndexSummary {
    pub symbol_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSdkIndexChunkSummary {
    pub indexed_files: usize,
    pub symbol_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceSdkCatalogChunk {
    pub(crate) root_path: String,
    pub(crate) sdk_path: String,
    pub(crate) sdk_version: String,
    pub(crate) identity: SharedSdkArtifactIdentity,
    pub(crate) symbols: Vec<WorkspaceSdkSymbol>,
    pub(crate) indexed_files: usize,
    pub(crate) replace_existing: bool,
    pub(crate) mark_ready: bool,
}

#[allow(dead_code)]
pub fn index_workspace_sdk_symbols(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
) -> Result<WorkspaceSdkIndexSummary, String> {
    if !Path::new(root_path).is_dir() || !Path::new(sdk_path).is_dir() {
        return Ok(WorkspaceSdkIndexSummary { symbol_count: 0 });
    }

    let root_key = normalize_index_path(root_path);
    let sdk_key = normalize_index_path(sdk_path);
    let symbols = collect_sdk_symbols(sdk_path)?;
    let identity = publish_complete_sdk_artifact(root_path, sdk_path, sdk_version, &symbols)?;
    with_workspace_index_transaction(root_path, ensure_workspace_index_schema, |transaction| {
        transaction
            .execute(
                "delete from workspace_sdk_symbols
                 where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
                params![root_key, sdk_key, sdk_version],
            )
            .map_err(|error| error.to_string())?;
        insert_sdk_symbols(transaction, &root_key, &sdk_key, sdk_version, &symbols)?;
        record_sdk_binding(
            transaction,
            &root_key,
            &sdk_key,
            sdk_version,
            &identity,
            "ready",
        )?;
        prune_superseded_sdk_symbols(transaction, &root_key, &sdk_key, sdk_version)
    })?;
    record_active_shared_sdk_reference(root_path, &identity)?;
    maintain_active_shared_sdk_store(root_path);

    Ok(WorkspaceSdkIndexSummary {
        symbol_count: symbols.len(),
    })
}

pub fn index_workspace_sdk_symbol_chunk(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    files: &[String],
    replace_existing: bool,
) -> Result<WorkspaceSdkIndexChunkSummary, String> {
    if !Path::new(root_path).is_dir() || !Path::new(sdk_path).is_dir() {
        return Ok(WorkspaceSdkIndexChunkSummary {
            indexed_files: 0,
            symbol_count: 0,
        });
    }
    let prepared = prepare_workspace_sdk_catalog_chunk(
        root_path,
        sdk_path,
        sdk_version,
        files,
        replace_existing,
        false,
    )?;
    publish_prepared_workspace_sdk_shared_chunk(&prepared)?;
    publish_prepared_workspace_sdk_catalog_chunk(&prepared)?;
    Ok(WorkspaceSdkIndexChunkSummary {
        indexed_files: prepared.indexed_files,
        symbol_count: prepared.symbols.len(),
    })
}

pub(crate) fn prepare_workspace_sdk_catalog_chunk(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    files: &[String],
    replace_existing: bool,
    mark_ready: bool,
) -> Result<PreparedWorkspaceSdkCatalogChunk, String> {
    let symbols = collect_sdk_symbols_from_files(files)?;
    let identity =
        prepare_sdk_artifact_identity(root_path, sdk_path, sdk_version, replace_existing)?;
    Ok(PreparedWorkspaceSdkCatalogChunk {
        root_path: root_path.to_string(),
        sdk_path: sdk_path.to_string(),
        sdk_version: sdk_version.to_string(),
        identity,
        symbols,
        indexed_files: files.len(),
        replace_existing,
        mark_ready,
    })
}

pub(crate) fn prepare_workspace_sdk_reuse(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    identity: SharedSdkArtifactIdentity,
) -> PreparedWorkspaceSdkCatalogChunk {
    PreparedWorkspaceSdkCatalogChunk {
        root_path: root_path.to_string(),
        sdk_path: sdk_path.to_string(),
        sdk_version: sdk_version.to_string(),
        identity,
        symbols: Vec::new(),
        indexed_files: 0,
        replace_existing: false,
        mark_ready: true,
    }
}

pub(crate) fn publish_prepared_workspace_sdk_shared_chunk(
    prepared: &PreparedWorkspaceSdkCatalogChunk,
) -> Result<(), String> {
    publish_prepared_shared_sdk_chunk(
        &prepared.root_path,
        &prepared.identity,
        &prepared.symbols,
        prepared.replace_existing,
        prepared.mark_ready,
    )
}

pub(crate) fn publish_prepared_workspace_sdk_catalog_chunk(
    prepared: &PreparedWorkspaceSdkCatalogChunk,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let root_key = normalize_index_path(&prepared.root_path);
    let sdk_key = normalize_index_path(&prepared.sdk_path);
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("sdkCatalogCommit", || {
        with_workspace_index_transaction(
            &prepared.root_path,
            ensure_workspace_index_schema,
            |transaction| {
                if prepared.replace_existing {
                    transaction
                        .execute(
                            "delete from workspace_sdk_symbols
                             where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
                            params![root_key, sdk_key, prepared.sdk_version],
                        )
                        .map_err(|error| error.to_string())?;
                }
                insert_sdk_symbols(
                    transaction,
                    &root_key,
                    &sdk_key,
                    &prepared.sdk_version,
                    &prepared.symbols,
                )?;
                record_sdk_binding(
                    transaction,
                    &root_key,
                    &sdk_key,
                    &prepared.sdk_version,
                    &prepared.identity,
                    if prepared.mark_ready {
                        "ready"
                    } else {
                        "building"
                    },
                )?;
                prune_superseded_sdk_symbols(
                    transaction,
                    &root_key,
                    &sdk_key,
                    &prepared.sdk_version,
                )
            },
        )
    })?;
    record_active_shared_sdk_reference(&prepared.root_path, &prepared.identity)?;
    if prepared.mark_ready {
        maintain_active_shared_sdk_store(&prepared.root_path);
    }
    let mut profile = profiler.finish();
    profile.root_path = prepared.root_path.clone();
    Ok(profile)
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

    let root_key = normalize_index_path(root_path);
    let pattern = format!("%{}%", escape_like_pattern(&query_terms.name_query));
    let first_char_pattern = query_terms
        .name_query
        .chars()
        .next()
        .map(|character| format!("%{}%", escape_like_pattern(&character.to_string())))
        .unwrap_or_else(|| pattern.clone());
    let fetch_limit = limit.saturating_mul(16).max(limit);
    if let Ok(Some(symbols)) =
        query_shared_sdk_name_candidates(root_path, &query_terms.name_query, fetch_limit)
    {
        return Ok(rank_sdk_symbols(symbols, &query_terms, limit));
    }
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "select symbol.kind, symbol.name, symbol.path, symbol.line, symbol.column,
                    symbol.container, symbol.signature
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1
               and (
                    lower(symbol.name) like ?2 escape '\\'
                    or lower(symbol.name) like ?3 escape '\\'
               )
             order by symbol.name, symbol.kind, symbol.path, symbol.line
             limit ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, pattern, first_char_pattern, fetch_limit as i64],
            |row| {
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
            },
        )
        .map_err(|error| error.to_string())?;

    let symbols = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rank_sdk_symbols(symbols, &query_terms, limit))
}

fn rank_sdk_symbols(
    symbols: Vec<WorkspaceSdkSymbol>,
    query_terms: &SdkQueryTerms,
    limit: usize,
) -> Vec<WorkspaceSearchCandidate> {
    let mut candidates = symbols
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
    candidates
}

fn insert_sdk_symbols(
    transaction: &Transaction<'_>,
    root_key: &str,
    sdk_key: &str,
    sdk_version: &str,
    symbols: &[WorkspaceSdkSymbol],
) -> Result<(), String> {
    for symbol in symbols {
        transaction
            .execute(
                "insert into workspace_sdk_symbols (
                    root_path, sdk_path, sdk_version, source, symbol_id, kind, name,
                    path, line, column, container, signature
                 ) values (?1, ?2, ?3, 'api', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    root_key,
                    sdk_key,
                    sdk_version,
                    sdk_symbol_id(
                        &symbol.path,
                        &symbol.kind,
                        symbol.container.as_deref(),
                        &symbol.name,
                        symbol.line as i64,
                        symbol.column as i64,
                    ),
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
    Ok(())
}

#[allow(dead_code)]
pub fn mark_workspace_sdk_artifact_ready(root_path: &str) -> Result<(), String> {
    mark_active_sdk_artifact_ready(root_path)?;
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        mark_sdk_binding_ready(connection, &normalize_index_path(root_path))
    })?;
    if let Some(identity) =
        crate::services::workspace_sdk_shared_bridge_service::load_active_sdk_identity(root_path)?
    {
        record_active_shared_sdk_reference(root_path, &identity)?;
    }
    maintain_active_shared_sdk_store(root_path);
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
    let container = symbol.container.clone();
    let id = sdk_symbol_id(
        &symbol.path,
        &symbol.kind,
        symbol.container.as_deref(),
        &symbol.name,
        symbol.line as i64,
        symbol.column as i64,
    );
    Some(WorkspaceSearchCandidate {
        id,
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
        container,
        signature: symbol.signature,
        visibility: None,
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

    let mut score = lexical_match_score(&symbol.name, &query_terms.name_query)?;

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

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
