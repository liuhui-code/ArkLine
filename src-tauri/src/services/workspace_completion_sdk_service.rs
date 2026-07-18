use rusqlite::{params, Connection};
use serde_json::json;

use crate::models::language::CompletionItem;
use crate::services::workspace_completion_item_service::completion_item;
use crate::services::workspace_index_query_path_service::{normalize_index_path, open_index_store};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_sdk_shared_bridge_service::query_shared_sdk_prefix_candidates;
use crate::services::workspace_symbol_identity_service::sdk_symbol_id;

pub fn sdk_member_completion_items(
    root_path: &str,
    connection: &Connection,
    root_key: &str,
    receiver_type: &str,
    prefix: &str,
) -> Result<Vec<CompletionItem>, String> {
    if let Ok(Some(symbols)) =
        query_shared_sdk_prefix_candidates(root_path, prefix, Some(receiver_type), 50)
    {
        return Ok(symbols.into_iter().map(to_completion_item).collect());
    }
    ensure_workspace_index_schema(connection)?;
    let pattern = format!("{}%", escape_like_pattern(prefix));
    let suffix = format!("%.{}", receiver_type);
    let mut statement = connection
        .prepare(
            "select symbol.name, symbol.kind, symbol.signature, symbol.path, symbol.line,
                    symbol.column, symbol.symbol_id
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1
               and symbol.container is not null
               and (symbol.container = ?2 or symbol.container like ?3)
               and symbol.name like ?4
             order by symbol.name, symbol.kind, symbol.path, symbol.line
             limit 50",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, receiver_type, suffix, pattern],
            map_completion_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn sdk_symbol_completion_items(
    root_path: &str,
    prefix: &str,
    limit: usize,
) -> Result<Vec<CompletionItem>, String> {
    if prefix.is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(Some(symbols)) =
        query_shared_sdk_prefix_candidates(root_path, prefix, None, limit.clamp(1, 100))
    {
        return Ok(symbols.into_iter().map(to_completion_item).collect());
    }
    let connection = match open_index_store(root_path) {
        Ok(connection) => connection,
        Err(_) => return Ok(Vec::new()),
    };
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let pattern = format!("{}%", escape_like_pattern(prefix));
    let mut statement = connection
        .prepare(
            "select symbol.name, symbol.kind, symbol.signature, symbol.path, symbol.line,
                    symbol.column, symbol.symbol_id
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1 and symbol.name like ?2
             order by symbol.name, symbol.kind, symbol.path, symbol.line
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, pattern, bounded_limit(limit)],
            map_completion_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn to_completion_item(symbol: WorkspaceSdkSymbol) -> CompletionItem {
    let symbol_id = sdk_symbol_id(
        &symbol.path,
        &symbol.kind,
        symbol.container.as_deref(),
        &symbol.name,
        symbol.line as i64,
        symbol.column as i64,
    );
    completion_item(
        &symbol.name,
        &symbol.kind,
        symbol.signature.as_deref().unwrap_or("SDK API"),
        "sdk",
        Some(json!({
            "symbolId": symbol_id,
            "importPath": symbol.path,
            "line": symbol.line,
            "column": symbol.column,
        })),
    )
}

fn map_completion_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CompletionItem> {
    let path: String = row.get(3)?;
    let line: i64 = row.get(4)?;
    let column: i64 = row.get(5)?;
    let symbol_id: String = row.get(6)?;
    Ok(completion_item(
        &row.get::<_, String>(0)?,
        &row.get::<_, String>(1)?,
        row.get::<_, Option<String>>(2)?
            .as_deref()
            .unwrap_or("SDK API"),
        "sdk",
        Some(json!({
            "symbolId": symbol_id,
            "importPath": path,
            "line": line,
            "column": column,
        })),
    ))
}

fn bounded_limit(limit: usize) -> i64 {
    i64::try_from(limit.clamp(1, 100)).unwrap_or(100)
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
