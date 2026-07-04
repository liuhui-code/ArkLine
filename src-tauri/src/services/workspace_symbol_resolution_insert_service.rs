use rusqlite::{params, Connection, Statement};

use crate::services::workspace_symbol_resolution_model_service::StubDeclarationRow;

pub struct ResolvedSymbolInserter<'a> {
    statement: Statement<'a>,
}

impl<'a> ResolvedSymbolInserter<'a> {
    pub fn new(connection: &'a Connection) -> Result<Self, String> {
        Ok(Self {
            statement: connection
                .prepare(
                    "insert into workspace_resolved_symbols (
                        root_path, symbol_id, path, name, qualified_name, kind, container,
                        signature, visibility, target_symbol_id, source, line, column,
                        indexed_generation
                     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                )
                .map_err(|error| error.to_string())?,
        })
    }

    pub fn insert(
        &mut self,
        root_key: &str,
        id: &str,
        declaration: &StubDeclarationRow,
        name: &str,
        qualified_name: &str,
        source: &str,
        target_symbol_id: Option<&str>,
        indexed_generation: u64,
    ) -> Result<(), String> {
        self.insert_fields(
            root_key,
            id,
            &declaration.path,
            name,
            qualified_name,
            &declaration.kind,
            declaration.container.as_deref(),
            Some(&declaration.signature),
            declaration.visibility.as_deref(),
            target_symbol_id,
            source,
            declaration.line,
            declaration.column,
            indexed_generation,
        )
    }

    pub fn insert_fields(
        &mut self,
        root_key: &str,
        id: &str,
        path: &str,
        name: &str,
        qualified_name: &str,
        kind: &str,
        container: Option<&str>,
        signature: Option<&str>,
        visibility: Option<&str>,
        target_symbol_id: Option<&str>,
        source: &str,
        line: i64,
        column: i64,
        indexed_generation: u64,
    ) -> Result<(), String> {
        self.statement
            .execute(params![
                root_key,
                id,
                path,
                name,
                qualified_name,
                kind,
                container,
                signature,
                visibility,
                target_symbol_id,
                source,
                line,
                column,
                indexed_generation as i64,
            ])
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
