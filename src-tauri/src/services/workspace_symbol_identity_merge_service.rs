use rusqlite::params;

use crate::services::workspace_index_query_path_service::{normalize_index_path, open_index_store};
use crate::services::workspace_sdk_shared_bridge_service::{
    query_shared_sdk_exact_symbols, query_shared_sdk_symbol_by_id,
};
use crate::services::workspace_symbol_identity_service::sdk_symbol_id;
use crate::services::workspace_symbol_resolution_query_service::query_resolved_symbol_by_id;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SymbolIdentityKey {
    kind: String,
    name: String,
    container: Option<String>,
}

pub fn query_merged_symbol_ids(root_path: &str, symbol_id: &str) -> Result<Vec<String>, String> {
    let mut ids = vec![symbol_id.to_string()];
    if symbol_id.starts_with("project:") {
        ids.extend(query_sdk_ids_for_project_symbol(root_path, symbol_id)?);
    } else if symbol_id.starts_with("sdk:") {
        ids.extend(query_project_ids_for_sdk_symbol(root_path, symbol_id)?);
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn query_sdk_ids_for_project_symbol(
    root_path: &str,
    symbol_id: &str,
) -> Result<Vec<String>, String> {
    let Some(symbol) = query_resolved_symbol_by_id(root_path, symbol_id)? else {
        return Ok(Vec::new());
    };
    query_sdk_ids_by_key(
        root_path,
        &SymbolIdentityKey {
            kind: symbol.kind,
            name: symbol.name,
            container: symbol.container,
        },
    )
}

fn query_project_ids_for_sdk_symbol(
    root_path: &str,
    symbol_id: &str,
) -> Result<Vec<String>, String> {
    let Some(key) = query_sdk_key_by_id(root_path, symbol_id)? else {
        return Ok(Vec::new());
    };
    query_project_ids_by_key(root_path, &key)
}

fn query_sdk_key_by_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Option<SymbolIdentityKey>, String> {
    if let Ok(Some(symbol)) = query_shared_sdk_symbol_by_id(root_path, symbol_id) {
        return Ok(Some(SymbolIdentityKey {
            kind: symbol.kind,
            name: symbol.name,
            container: symbol.container,
        }));
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol.kind, symbol.name, symbol.container
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1 and symbol.symbol_id = ?2
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key, symbol_id], |row| {
            Ok(SymbolIdentityKey {
                kind: row.get(0)?,
                name: row.get(1)?,
                container: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
}

fn query_sdk_ids_by_key(root_path: &str, key: &SymbolIdentityKey) -> Result<Vec<String>, String> {
    if let Ok(Some(symbols)) = query_shared_sdk_exact_symbols(
        root_path,
        &key.kind,
        &key.name,
        key.container.as_deref(),
        16,
    ) {
        return Ok(symbols
            .into_iter()
            .map(|symbol| {
                sdk_symbol_id(
                    &symbol.path,
                    &symbol.kind,
                    symbol.container.as_deref(),
                    &symbol.name,
                    symbol.line as i64,
                    symbol.column as i64,
                )
            })
            .collect());
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol.symbol_id
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1
               and symbol.kind = ?2
               and symbol.name = ?3
               and coalesce(symbol.container, '') = ?4
             order by symbol.path, symbol.line, symbol.column
             limit 16",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                root_key,
                key.kind,
                key.name,
                key.container.as_deref().unwrap_or_default()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn query_project_ids_by_key(
    root_path: &str,
    key: &SymbolIdentityKey,
) -> Result<Vec<String>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol_id
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and kind = ?2
               and name = ?3
               and coalesce(container, '') = ?4
             order by path, line, column
             limit 16",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                root_key,
                key.kind,
                key.name,
                key.container.as_deref().unwrap_or_default()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}
