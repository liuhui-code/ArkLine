use rusqlite::{params, Connection};

use crate::services::workspace_symbol_identity_service::project_symbol_id;
use crate::services::workspace_symbol_resolution_alias_service::{
    insert_export_alias_symbol, insert_import_alias_symbol, AliasTarget, ExportAliasTarget,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSymbolResolutionSummary {
    pub resolved_count: usize,
    pub unresolved_count: usize,
}

pub fn resolve_workspace_symbols(
    connection: &Connection,
    root_key: &str,
    indexed_generation: u64,
) -> Result<WorkspaceSymbolResolutionSummary, String> {
    connection
        .execute(
            "delete from workspace_resolved_symbols where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_unresolved_symbols where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;

    let declarations = load_stub_declarations(connection, root_key)?;
    let mut resolved_count = 0;
    for declaration in &declarations {
        insert_resolved_symbol(
            connection,
            root_key,
            &symbol_id(declaration),
            declaration,
            &declaration.name,
            &declaration.qualified_name,
            "project",
            None,
            indexed_generation,
        )?;
        resolved_count += 1;
    }
    let mut export_aliases = Vec::new();
    for export in load_resolved_re_exports(connection, root_key)? {
        let Some(target) = declarations.iter().find(|declaration| {
            declaration.path == export.to_path && declaration.name == export.local_name
        }) else {
            insert_unresolved_symbol(
                connection,
                root_key,
                &export.from_path,
                &export.exported_name,
                &format!("unresolved export binding: {}", export.source_module),
                export.line,
                export.column,
                indexed_generation,
            )?;
            continue;
        };
        let target_symbol_id = symbol_id(target);
        insert_export_alias_symbol(
            connection,
            root_key,
            &format!(
                "export:{}:{}:{}:{}",
                export.from_path, export.exported_name, export.line, export.column
            ),
            &export,
            target,
            indexed_generation,
        )?;
        export_aliases.push(ExportAliasTarget {
            path: export.from_path,
            exported_name: export.exported_name,
            target_symbol_id,
            kind: target.kind.clone(),
            container: target.container.clone(),
            signature: Some(target.signature.clone()),
            visibility: target.visibility.clone(),
        });
        resolved_count += 1;
    }
    for import in load_resolved_imports(connection, root_key)? {
        let declaration_target = declarations.iter().find(|declaration| {
            declaration.path == import.to_path && declaration.name == import.imported_name
        });
        let export_target = export_aliases.iter().find(|alias| {
            alias.path == import.to_path && alias.exported_name == import.imported_name
        });
        let Some(target) = import_alias_target(declaration_target, export_target) else {
            insert_unresolved_symbol(
                connection,
                root_key,
                &import.from_path,
                &import.local_name,
                &format!("unresolved import binding: {}", import.source_module),
                import.line,
                import.column,
                indexed_generation,
            )?;
            continue;
        };
        insert_import_alias_symbol(
            connection,
            root_key,
            &format!(
                "import:{}:{}:{}:{}",
                import.from_path, import.local_name, import.line, import.column
            ),
            &import,
            &target,
            indexed_generation,
        )?;
        resolved_count += 1;
    }
    let unresolved_imports = load_unresolved_imports(connection, root_key)?;
    for import in &unresolved_imports {
        insert_unresolved_symbol(
            connection,
            root_key,
            &import.from_path,
            &import.local_name,
            &format!("unresolved import: {}", import.source_module),
            import.line,
            import.column,
            indexed_generation,
        )?;
    }

    Ok(WorkspaceSymbolResolutionSummary {
        resolved_count,
        unresolved_count: unresolved_imports.len(),
    })
}

fn insert_resolved_symbol(
    connection: &Connection,
    root_key: &str,
    id: &str,
    declaration: &StubDeclarationRow,
    name: &str,
    qualified_name: &str,
    source: &str,
    target_symbol_id: Option<&str>,
    indexed_generation: u64,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_resolved_symbols (
                root_path, symbol_id, path, name, qualified_name, kind, container,
                signature, visibility, target_symbol_id, source, line, column, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                root_key,
                id,
                declaration.path,
                name,
                qualified_name,
                declaration.kind,
                declaration.container,
                declaration.signature,
                declaration.visibility,
                target_symbol_id,
                source,
                declaration.line,
                declaration.column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn import_alias_target(
    declaration: Option<&StubDeclarationRow>,
    export_alias: Option<&ExportAliasTarget>,
) -> Option<AliasTarget> {
    if let Some(declaration) = declaration {
        return Some(AliasTarget {
            symbol_id: symbol_id(declaration),
            kind: declaration.kind.clone(),
            container: declaration.container.clone(),
            signature: Some(declaration.signature.clone()),
            visibility: declaration.visibility.clone(),
        });
    }
    export_alias.map(|alias| AliasTarget {
        symbol_id: alias.target_symbol_id.clone(),
        kind: alias.kind.clone(),
        container: alias.container.clone(),
        signature: alias.signature.clone(),
        visibility: alias.visibility.clone(),
    })
}

fn insert_unresolved_symbol(
    connection: &Connection,
    root_key: &str,
    path: &str,
    name: &str,
    reason: &str,
    line: i64,
    column: i64,
    indexed_generation: u64,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_unresolved_symbols (
                root_path, path, name, reason, line, column, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                root_key,
                path,
                name,
                reason,
                line,
                column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_stub_declarations(
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
        .query_map(params![root_key], |row| {
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
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_resolved_imports(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ImportBindingRow>, String> {
    let mut statement = connection
        .prepare(
            "select imports.path, imports.source_module,
                    coalesce(imports.imported_name, imports.local_name),
                    imports.local_name, imports.line, imports.column, edges.to_path
             from workspace_stub_imports imports
             join workspace_dependency_edges edges
                on edges.root_path = imports.root_path
               and edges.from_path = imports.path
               and edges.source_module = imports.source_module
               and edges.kind = 'import'
             where imports.root_path = ?1
             order by imports.path, imports.line, imports.column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], import_binding_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_unresolved_imports(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<UnresolvedImportRow>, String> {
    let mut statement = connection
        .prepare(
            "select imports.path, imports.source_module, imports.local_name, imports.line, imports.column
             from workspace_stub_imports imports
             join workspace_unresolved_imports unresolved
                on unresolved.root_path = imports.root_path
               and unresolved.from_path = imports.path
               and unresolved.source_module = imports.source_module
             where imports.root_path = ?1
             order by imports.path, imports.line, imports.column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(UnresolvedImportRow {
                from_path: row.get(0)?,
                source_module: row.get(1)?,
                local_name: row.get(2)?,
                line: row.get(3)?,
                column: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_resolved_re_exports(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ExportBindingRow>, String> {
    let mut statement = connection
        .prepare(
            "select exports.path, exports.source_module, exports.local_name,
                    exports.exported_name, exports.line, exports.column, edges.to_path
             from workspace_stub_exports exports
             join workspace_dependency_edges edges
                on edges.root_path = exports.root_path
               and edges.from_path = exports.path
               and edges.source_module = exports.source_module
               and edges.kind = 'export'
             where exports.root_path = ?1
               and exports.source_module is not null
               and exports.local_name is not null
             order by exports.path, exports.line, exports.column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(ExportBindingRow {
                from_path: row.get(0)?,
                source_module: row.get(1)?,
                local_name: row.get(2)?,
                exported_name: row.get(3)?,
                line: row.get(4)?,
                column: row.get(5)?,
                to_path: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn import_binding_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ImportBindingRow> {
    Ok(ImportBindingRow {
        from_path: row.get(0)?,
        source_module: row.get(1)?,
        imported_name: row.get(2)?,
        local_name: row.get(3)?,
        line: row.get(4)?,
        column: row.get(5)?,
        to_path: row.get(6)?,
    })
}

pub(crate) fn symbol_id(declaration: &StubDeclarationRow) -> String {
    project_symbol_id(
        &declaration.path,
        &declaration.kind,
        &declaration.qualified_name,
        declaration.line,
        declaration.column,
    )
}

pub(crate) struct StubDeclarationRow {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) qualified_name: String,
    pub(crate) container: Option<String>,
    pub(crate) signature: String,
    pub(crate) visibility: Option<String>,
    pub(crate) line: i64,
    pub(crate) column: i64,
}

pub(crate) struct ImportBindingRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) imported_name: String,
    pub(crate) local_name: String,
    pub(crate) line: i64,
    pub(crate) column: i64,
    pub(crate) to_path: String,
}

struct UnresolvedImportRow {
    from_path: String,
    source_module: String,
    local_name: String,
    line: i64,
    column: i64,
}

pub(crate) struct ExportBindingRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) local_name: String,
    pub(crate) exported_name: String,
    pub(crate) line: i64,
    pub(crate) column: i64,
    pub(crate) to_path: String,
}
