use std::collections::HashMap;

use rusqlite::{params, Connection};

pub struct DeclarationReference {
    symbol_id: String,
    name: String,
    container: Option<String>,
    line: i64,
    column: i64,
}

pub fn load_workspace_declarations(
    connection: &Connection,
    root_key: &str,
) -> Result<HashMap<String, Vec<DeclarationReference>>, String> {
    let mut statement = connection
        .prepare(
            "select path, symbol_id, name, container, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and source = 'project'",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                DeclarationReference {
                    symbol_id: row.get(1)?,
                    name: row.get(2)?,
                    container: row.get(3)?,
                    line: row.get(4)?,
                    column: row.get(5)?,
                },
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut declarations: HashMap<String, Vec<DeclarationReference>> = HashMap::new();
    for row in rows {
        let (path, declaration) = row.map_err(|error| error.to_string())?;
        declarations.entry(path).or_default().push(declaration);
    }
    Ok(declarations)
}

pub fn index_workspace_declarations(
    connection: &Connection,
    root_key: &str,
    path: &str,
    declarations: &HashMap<String, Vec<DeclarationReference>>,
    indexed_generation: u64,
) -> Result<(), String> {
    let Some(file_declarations) = declarations.get(path) else {
        return Ok(());
    };
    for declaration in file_declarations {
        insert_declaration_reference(connection, root_key, path, declaration, indexed_generation)?;
    }
    Ok(())
}

fn insert_declaration_reference(
    connection: &Connection,
    root_key: &str,
    path: &str,
    declaration: &DeclarationReference,
    indexed_generation: u64,
) -> Result<(), String> {
    let end_column = declaration.column + i64::try_from(declaration.name.len()).unwrap_or_default();
    connection
        .execute(
            "insert or replace into workspace_symbol_references (
                root_path, path, reference_id, symbol_id, name, kind, container,
                line, column, end_line, end_column, confidence, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, 'declaration', ?6, ?7, ?8, ?7, ?9, 'exact', ?10)",
            params![
                root_key,
                path,
                format!(
                    "{path}:declaration:{}:{}:{}",
                    declaration.name, declaration.line, declaration.column
                ),
                declaration.symbol_id,
                declaration.name,
                declaration.container,
                declaration.line,
                declaration.column,
                end_column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
