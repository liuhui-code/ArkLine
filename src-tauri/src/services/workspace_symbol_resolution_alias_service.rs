use rusqlite::{params, Connection};

use crate::services::workspace_symbol_resolution_service::{
    symbol_id, ExportBindingRow, ImportBindingRow, StubDeclarationRow,
};

pub struct AliasTarget {
    pub symbol_id: String,
    pub kind: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub visibility: Option<String>,
}

pub struct ExportAliasTarget {
    pub path: String,
    pub exported_name: String,
    pub target_symbol_id: String,
    pub kind: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub visibility: Option<String>,
}

pub fn insert_import_alias_symbol(
    connection: &Connection,
    root_key: &str,
    id: &str,
    import: &ImportBindingRow,
    target: &AliasTarget,
    indexed_generation: u64,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_resolved_symbols (
                root_path, symbol_id, path, name, qualified_name, kind, container,
                signature, visibility, target_symbol_id, source, line, column, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'import', ?11, ?12, ?13)",
            params![
                root_key,
                id,
                import.from_path,
                import.local_name,
                import.local_name,
                target.kind,
                target.container,
                target.signature,
                target.visibility,
                target.symbol_id,
                import.line,
                import.column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn insert_export_alias_symbol(
    connection: &Connection,
    root_key: &str,
    id: &str,
    export: &ExportBindingRow,
    target: &StubDeclarationRow,
    indexed_generation: u64,
) -> Result<(), String> {
    let target_symbol_id = symbol_id(target);
    connection
        .execute(
            "insert into workspace_resolved_symbols (
                root_path, symbol_id, path, name, qualified_name, kind, container,
                signature, visibility, target_symbol_id, source, line, column, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'export', ?11, ?12, ?13)",
            params![
                root_key,
                id,
                export.from_path,
                export.exported_name,
                export.exported_name,
                target.kind,
                target.container,
                target.signature,
                target.visibility,
                target_symbol_id,
                export.line,
                export.column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
