use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::services::workspace_symbol_resolution_model_service::StubDeclarationRow;

pub(crate) fn load_stub_declarations(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<StubDeclarationRow>, String> {
    let mut statement = connection
        .prepare(
            "select path, kind, name, qualified_name, container, signature, visibility, line, column
             from workspace_stub_declarations
             where root_path = ?1
             order by path, line, column, kind, qualified_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], stub_declaration_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn load_stub_declarations_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &HashSet<String>,
) -> Result<Vec<StubDeclarationRow>, String> {
    let mut declarations = Vec::new();
    let mut statement = connection
        .prepare(
            "select path, kind, name, qualified_name, container, signature, visibility, line, column
             from workspace_stub_declarations
             where root_path = ?1 and path = ?2
             order by path, line, column, kind, qualified_name",
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        let rows = statement
            .query_map(params![root_key, path], stub_declaration_from_row)
            .map_err(|error| error.to_string())?;
        declarations.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(declarations)
}

pub(crate) fn has_import_or_export_bindings_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &HashSet<String>,
) -> Result<bool, String> {
    let mut import_statement = connection
        .prepare("select exists(select 1 from workspace_stub_imports where root_path = ?1 and path = ?2)")
        .map_err(|error| error.to_string())?;
    let mut export_statement = connection
        .prepare(
            "select exists(
                select 1 from workspace_stub_exports
                where root_path = ?1 and path = ?2 and source_module is not null
             )",
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        let has_import = import_statement
            .query_row(params![root_key, path], |row| row.get::<_, bool>(0))
            .map_err(|error| error.to_string())?;
        if has_import {
            return Ok(true);
        }
        let has_export = export_statement
            .query_row(params![root_key, path], |row| row.get::<_, bool>(0))
            .map_err(|error| error.to_string())?;
        if has_export {
            return Ok(true);
        }
    }
    Ok(false)
}

fn stub_declaration_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StubDeclarationRow> {
    Ok(StubDeclarationRow {
        path: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        qualified_name: row.get(3)?,
        container: row.get(4)?,
        signature: row.get(5)?,
        visibility: row.get(6)?,
        line: row.get(7)?,
        column: row.get(8)?,
    })
}
