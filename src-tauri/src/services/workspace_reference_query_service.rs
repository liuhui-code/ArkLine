use std::path::Path;

use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSymbolReferenceRow {
    pub path: String,
    pub reference_id: String,
    pub symbol_id: Option<String>,
    pub name: String,
    pub kind: String,
    pub container: Option<String>,
    pub line: i64,
    pub column: i64,
    pub end_line: i64,
    pub end_column: i64,
    pub confidence: String,
}

pub fn query_references_by_symbol_id(
    root_path: &str,
    symbol_id: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSymbolReferenceRow>, String> {
    let connection = Connection::open(reference_catalog_cache_path(root_path))
        .map_err(|error| error.to_string())?;
    let root_key = normalize_reference_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select path, reference_id, symbol_id, name, kind, container,
                    line, column, end_line, end_column, confidence
             from workspace_symbol_references
             where root_path = ?1 and symbol_id = ?2
             order by
                case confidence
                    when 'exact' then 0
                    when 'resolvedAlias' then 1
                    when 'memberResolved' then 2
                    when 'localScope' then 3
                    when 'unresolvedLikely' then 4
                    else 9
                end,
                path, line, column
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, symbol_id, bounded_reference_query_limit(limit)],
            reference_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn query_reference_at_position(
    root_path: &str,
    path: &str,
    line: u32,
    column: u32,
) -> Result<Option<WorkspaceSymbolReferenceRow>, String> {
    let connection = Connection::open(reference_catalog_cache_path(root_path))
        .map_err(|error| error.to_string())?;
    let root_key = normalize_reference_index_path(root_path);
    let path_key = normalize_reference_index_path(path);
    let mut statement = connection
        .prepare(
            "select path, reference_id, symbol_id, name, kind, container,
                    line, column, end_line, end_column, confidence
             from workspace_symbol_references
             where root_path = ?1
               and path = ?2
               and line = ?3
               and column <= ?4
               and end_column >= ?4
             order by
               case kind when 'memberAccess' then 0 when 'identifier' then 1 else 2 end,
               column desc
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(
            params![root_key, path_key, line as i64, column as i64],
            reference_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
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

pub(crate) fn is_reference_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

pub(crate) fn normalize_reference_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

pub(crate) fn reference_catalog_cache_path(root_path: &str) -> std::path::PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

pub(crate) fn bounded_reference_query_limit(limit: usize) -> i64 {
    i64::try_from(limit.clamp(1, 500)).unwrap_or(500)
}
