use std::collections::HashSet;

use rusqlite::{params, Connection, Statement};

use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexedSymbol};

pub fn persist_metadata_row(
    connection: &Connection,
    root_key: &str,
    state: &WorkspaceIndexState,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_index_metadata (
                root_path, status, indexed_at, partial_reason, updated_at
             ) values (?1, ?2, ?3, ?4, strftime('%s','now') * 1000)
             on conflict(root_path) do update set
                status = excluded.status,
                indexed_at = excluded.indexed_at,
                partial_reason = excluded.partial_reason,
                updated_at = excluded.updated_at",
            params![
                root_key,
                state.status.to_string(),
                state.indexed_at.map(|value| value as i64),
                state.partial_reason,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn replace_changed_files(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    for path in removed_paths.iter().map(|path| normalize_index_path(path)) {
        connection
            .execute(
                "delete from workspace_files where root_path = ?1 and path = ?2",
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }
    for path in file_paths {
        connection
            .execute(
                "insert or ignore into workspace_files (root_path, path) values (?1, ?2)",
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn replace_changed_symbols(
    connection: &Connection,
    root_key: &str,
    symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let mut affected_paths = changed_paths
        .iter()
        .chain(removed_paths.iter())
        .map(|path| normalize_index_path(path))
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();
    let affected_path_set = affected_paths.iter().cloned().collect::<HashSet<_>>();

    for path in &affected_paths {
        delete_symbols_for_path(connection, root_key, path)?;
    }
    let mut legacy_statement = legacy_symbol_insert_statement(connection)?;
    let mut entity_statement = symbol_entity_insert_statement(connection)?;
    for symbol in symbols
        .iter()
        .filter(|symbol| affected_path_set.contains(&normalize_index_path(&symbol.path)))
    {
        insert_legacy_symbol_with_statement(&mut legacy_statement, root_key, symbol)?;
        insert_symbol_entity_with_statement(&mut entity_statement, root_key, symbol)?;
    }
    Ok(())
}

pub fn insert_legacy_symbol(
    connection: &Connection,
    root_key: &str,
    symbol: &WorkspaceIndexedSymbol,
) -> Result<(), String> {
    let mut statement = legacy_symbol_insert_statement(connection)?;
    insert_legacy_symbol_with_statement(&mut statement, root_key, symbol)
}

fn legacy_symbol_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_symbols (
                root_path, source, kind, name, path, line, column, container
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(|error| error.to_string())
}

fn insert_legacy_symbol_with_statement(
    statement: &mut Statement<'_>,
    root_key: &str,
    symbol: &WorkspaceIndexedSymbol,
) -> Result<(), String> {
    statement
        .execute(params![
            root_key,
            symbol.source,
            symbol.kind,
            symbol.name,
            symbol.path,
            symbol.line as i64,
            symbol.column as i64,
            symbol.container,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn insert_symbol_entity(
    connection: &Connection,
    root_key: &str,
    symbol: &WorkspaceIndexedSymbol,
) -> Result<(), String> {
    let mut statement = symbol_entity_insert_statement(connection)?;
    insert_symbol_entity_with_statement(&mut statement, root_key, symbol)
}

fn symbol_entity_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_symbol_entities (
                root_path, entity_id, qualified_name, source, kind, name, container,
                path, line, column, end_line, end_column, visibility, signature, origin
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, 'workspace')",
        )
        .map_err(|error| error.to_string())
}

fn insert_symbol_entity_with_statement(
    statement: &mut Statement<'_>,
    root_key: &str,
    symbol: &WorkspaceIndexedSymbol,
) -> Result<(), String> {
    let qualified_name = qualified_symbol_name(symbol);
    statement
        .execute(params![
            root_key,
            symbol_entity_id(symbol, &qualified_name),
            qualified_name,
            symbol.source,
            symbol.kind,
            symbol.name,
            symbol.container,
            symbol.path,
            symbol.line as i64,
            symbol.column as i64,
            symbol.line as i64,
            symbol_end_column(symbol) as i64,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn qualified_symbol_name(symbol: &WorkspaceIndexedSymbol) -> String {
    symbol
        .container
        .as_ref()
        .filter(|container| !container.is_empty())
        .map(|container| format!("{container}.{}", symbol.name))
        .unwrap_or_else(|| symbol.name.clone())
}

fn symbol_entity_id(symbol: &WorkspaceIndexedSymbol, qualified_name: &str) -> String {
    format!(
        "workspace:{}:{}:{}:{}:{}:{}",
        symbol.source, symbol.kind, qualified_name, symbol.path, symbol.line, symbol.column
    )
}

fn symbol_end_column(symbol: &WorkspaceIndexedSymbol) -> usize {
    symbol
        .column
        .saturating_add(symbol.name.len().saturating_sub(1))
}

fn delete_symbols_for_path(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_symbols where root_path = ?1 and path = ?2",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_symbol_entities where root_path = ?1 and path = ?2",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
