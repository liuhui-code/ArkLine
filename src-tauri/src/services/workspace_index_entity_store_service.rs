use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace::{WorkspaceIndexedSymbol, WorkspaceSearchCandidate};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, WorkspaceIndexReader,
};
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;

pub(crate) fn load_stub_symbols(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select declaration.kind, declaration.name, declaration.path, declaration.line,
                declaration.column, declaration.container, declaration.signature,
                declaration.visibility
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

pub(crate) fn load_symbol_entities(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container, signature, visibility
             from workspace_symbol_entities
             where root_path = ?1
             order by source, qualified_name, path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| row_to_symbol(row))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn load_file_stub_symbols(
    connection: &Connection,
    root_key: &str,
    file_path: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select declaration.kind, declaration.name, declaration.path, declaration.line,
                declaration.column, declaration.container, declaration.signature,
                declaration.visibility
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

pub(crate) fn load_file_symbol_entities(
    connection: &Connection,
    root_key: &str,
    file_path: &str,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select source, kind, name, path, line, column, container, signature, visibility
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

pub(crate) fn load_legacy_symbols(
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
                signature: None,
                visibility: None,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn load_legacy_file_symbols(
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

pub(crate) fn symbol_to_candidate(
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
        container: symbol.container,
        signature: symbol.signature,
        visibility: symbol.visibility,
    }
}

pub(crate) fn load_index_freshness(
    connection: &Connection,
    root_key: &str,
) -> Result<String, String> {
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

pub(crate) fn open_existing_index_store(
    root_path: &str,
) -> Result<Option<WorkspaceIndexReader<'static>>, String> {
    open_existing_workspace_index_reader(root_path)
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
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
        signature: row.get(6)?,
        visibility: row.get(7)?,
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
        signature: row.get(7)?,
        visibility: row.get(8)?,
    })
}

fn stub_source_for_kind(kind: &str) -> &str {
    if matches!(kind, "struct" | "class" | "interface" | "enum" | "type") {
        "class"
    } else {
        "symbol"
    }
}
