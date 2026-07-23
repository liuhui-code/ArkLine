#![allow(dead_code)]

use rusqlite::params;

use crate::services::workspace_index_connection_service::{
    require_existing_workspace_index_reader, WorkspaceIndexReader,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceResolvedSymbolRow {
    pub symbol_id: String,
    pub path: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub visibility: Option<String>,
    pub target_symbol_id: Option<String>,
    pub source: String,
    pub line: i64,
    pub column: i64,
}

pub fn query_resolved_symbols_by_name(
    root_path: &str,
    name: &str,
    limit: usize,
) -> Result<Vec<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and name = ?2
             order by
                case source when 'project' then 0 when 'import' then 1 when 'export' then 2 else 3 end,
                path, line, column
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, name, bounded_limit(limit)],
            resolved_symbol_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn query_resolved_symbols_by_target(
    root_path: &str,
    target_symbol_id: &str,
    limit: usize,
) -> Result<Vec<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and target_symbol_id = ?2
             order by path, line, column
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, target_symbol_id, bounded_limit(limit)],
            resolved_symbol_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn query_resolved_symbol_by_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Option<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and symbol_id = ?2
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key, symbol_id], resolved_symbol_from_row)
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
}

pub fn query_resolved_symbols_by_name_and_path(
    root_path: &str,
    name: &str,
    path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(path);
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and name = ?2 and path = ?3
             order by
                case source when 'project' then 0 when 'import' then 1 when 'export' then 2 else 3 end,
                line, column
             limit ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, name, path_key, bounded_limit(limit)],
            resolved_symbol_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn query_resolved_symbols_by_path(
    root_path: &str,
    path: &str,
    limit: usize,
) -> Result<Vec<WorkspaceResolvedSymbolRow>, String> {
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(path);
    let mut statement = connection
        .prepare(
            "select symbol_id, path, name, qualified_name, kind, container, signature,
                    visibility, target_symbol_id, source, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and path = ?2
             order by line, column, name
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, path_key, bounded_limit(limit)],
            resolved_symbol_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
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

fn open_index_store(root_path: &str) -> Result<WorkspaceIndexReader<'static>, String> {
    require_existing_workspace_index_reader(root_path)
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn bounded_limit(limit: usize) -> i64 {
    i64::try_from(limit.clamp(1, 500)).unwrap_or(500)
}
