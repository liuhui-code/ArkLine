use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::services::workspace_symbol_identity_service::project_symbol_id;
use crate::services::workspace_symbol_resolution_alias_service::{
    insert_export_alias_symbol, insert_import_alias_symbol, ExportAliasTarget,
};
use crate::services::workspace_symbol_resolution_declaration_service::{
    has_import_or_export_bindings_for_paths, load_stub_declarations,
    load_stub_declarations_for_paths,
};
use crate::services::workspace_symbol_resolution_insert_service::ResolvedSymbolInserter;
use crate::services::workspace_symbol_resolution_lookup_service::{
    declaration_lookup, export_alias_lookup, import_alias_target,
};
use crate::services::workspace_symbol_resolution_model_service::{
    ExportBindingRow, ImportBindingRow, StubDeclarationRow, UnresolvedImportRow,
};
use crate::services::workspace_symbol_resolution_path_plan_service::plan_symbol_resolution_paths;
use crate::services::workspace_symbol_resolution_refresh_plan_service::{
    plan_symbol_resolution_refresh, SymbolResolutionRefreshPlan,
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
    resolve_workspace_symbols_from_declarations(
        connection,
        root_key,
        indexed_generation,
        &declarations,
        None,
        true,
    )
}

pub fn resolve_workspace_symbols_for_paths(
    connection: &Connection,
    root_key: &str,
    indexed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceSymbolResolutionSummary, String> {
    let path_plan = plan_symbol_resolution_paths(indexed_paths, removed_paths);
    delete_symbol_resolution_for_paths(connection, root_key, &path_plan.affected_path_set)?;
    let plan = plan_symbol_resolution_refresh(has_import_or_export_bindings_for_paths(
        connection,
        root_key,
        &path_plan.affected_path_set,
    )?);
    if plan == SymbolResolutionRefreshPlan::DeclarationsOnly {
        let declarations =
            load_stub_declarations_for_paths(connection, root_key, &path_plan.affected_path_set)?;
        return resolve_workspace_symbols_from_declarations(
            connection,
            root_key,
            indexed_generation,
            &declarations,
            None,
            false,
        );
    }
    let declarations = load_stub_declarations(connection, root_key)?;
    resolve_workspace_symbols_from_declarations(
        connection,
        root_key,
        indexed_generation,
        &declarations,
        Some(&path_plan.affected_path_set),
        true,
    )
}

fn resolve_workspace_symbols_from_declarations(
    connection: &Connection,
    root_key: &str,
    indexed_generation: u64,
    declarations: &[StubDeclarationRow],
    affected_paths: Option<&HashSet<String>>,
    include_bindings: bool,
) -> Result<WorkspaceSymbolResolutionSummary, String> {
    let mut resolved_count = 0;
    let mut resolved_inserter = ResolvedSymbolInserter::new(connection)?;
    for declaration in declarations
        .iter()
        .filter(|declaration| should_resolve_path(affected_paths, &declaration.path))
    {
        resolved_inserter.insert(
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
    if !include_bindings {
        return Ok(WorkspaceSymbolResolutionSummary {
            resolved_count,
            unresolved_count: 0,
        });
    }
    let re_exports = load_resolved_re_exports(connection, root_key)?
        .into_iter()
        .filter(|export| should_resolve_path(affected_paths, &export.from_path))
        .collect::<Vec<_>>();
    let imports = load_resolved_imports(connection, root_key)?
        .into_iter()
        .filter(|import| should_resolve_path(affected_paths, &import.from_path))
        .collect::<Vec<_>>();
    let declaration_lookup =
        (!re_exports.is_empty() || !imports.is_empty()).then(|| declaration_lookup(declarations));
    let needs_export_aliases = !imports.is_empty();
    let mut export_aliases = if needs_export_aliases {
        export_alias_lookup(load_existing_export_aliases(connection, root_key)?)
    } else {
        export_alias_lookup(Vec::new())
    };
    for export in re_exports {
        let Some(target) = declaration_lookup
            .as_ref()
            .and_then(|lookup| lookup.get(&(export.to_path.clone(), export.local_name.clone())))
            .copied()
        else {
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
            &mut resolved_inserter,
            root_key,
            &format!(
                "export:{}:{}:{}:{}",
                export.from_path, export.exported_name, export.line, export.column
            ),
            &export,
            target,
            indexed_generation,
        )?;
        if needs_export_aliases {
            export_aliases.insert(
                (export.from_path.clone(), export.exported_name.clone()),
                ExportAliasTarget {
                    path: export.from_path,
                    exported_name: export.exported_name,
                    target_symbol_id,
                    kind: target.kind.clone(),
                    container: target.container.clone(),
                    signature: Some(target.signature.clone()),
                    visibility: target.visibility.clone(),
                },
            );
        }
        resolved_count += 1;
    }
    for import in imports {
        let declaration_target = declaration_lookup
            .as_ref()
            .and_then(|lookup| lookup.get(&(import.to_path.clone(), import.imported_name.clone())))
            .copied();
        let export_target =
            export_aliases.get(&(import.to_path.clone(), import.imported_name.clone()));
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
            &mut resolved_inserter,
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
    let unresolved_imports = load_unresolved_imports(connection, root_key)?
        .into_iter()
        .filter(|import| should_resolve_path(affected_paths, &import.from_path))
        .collect::<Vec<_>>();
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

fn should_resolve_path(affected_paths: Option<&HashSet<String>>, path: &str) -> bool {
    affected_paths.is_none_or(|paths| paths.contains(path))
}

fn delete_symbol_resolution_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &HashSet<String>,
) -> Result<(), String> {
    let mut resolved_statement = connection
        .prepare("delete from workspace_resolved_symbols where root_path = ?1 and path = ?2")
        .map_err(|error| error.to_string())?;
    let mut unresolved_statement = connection
        .prepare("delete from workspace_unresolved_symbols where root_path = ?1 and path = ?2")
        .map_err(|error| error.to_string())?;
    for path in paths {
        resolved_statement
            .execute(params![root_key, path])
            .map_err(|error| error.to_string())?;
        unresolved_statement
            .execute(params![root_key, path])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
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

fn load_existing_export_aliases(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ExportAliasTarget>, String> {
    let mut statement = connection
        .prepare(
            "select path, name, target_symbol_id, kind, container, signature, visibility
             from workspace_resolved_symbols
             where root_path = ?1 and source = 'export' and target_symbol_id is not null",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(ExportAliasTarget {
                path: row.get(0)?,
                exported_name: row.get(1)?,
                target_symbol_id: row.get(2)?,
                kind: row.get(3)?,
                container: row.get(4)?,
                signature: row.get(5)?,
                visibility: row.get(6)?,
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
