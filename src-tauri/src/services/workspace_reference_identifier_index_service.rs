use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, Statement};

pub type ReferenceAliasTargets = HashMap<(String, String), String>;

pub fn load_reference_alias_targets(
    connection: &Connection,
    root_key: &str,
) -> Result<ReferenceAliasTargets, String> {
    let mut statement = connection
        .prepare(
            "select path, name, target_symbol_id
             from workspace_resolved_symbols
             where root_path = ?1 and target_symbol_id is not null",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok((
                (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<ReferenceAliasTargets, _>>()
        .map_err(|error| error.to_string())
}

pub fn load_reference_alias_targets_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &HashSet<String>,
) -> Result<ReferenceAliasTargets, String> {
    let mut aliases = ReferenceAliasTargets::new();
    let mut statement = connection
        .prepare(
            "select path, name, target_symbol_id
             from workspace_resolved_symbols
             where root_path = ?1 and path = ?2 and target_symbol_id is not null",
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        let rows = statement
            .query_map(params![root_key, path], |row| {
                Ok((
                    (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        aliases.extend(
            rows.collect::<Result<ReferenceAliasTargets, _>>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(aliases)
}

pub fn index_workspace_identifier_references(
    connection: &Connection,
    root_key: &str,
    path: &str,
    content: &str,
    aliases: &ReferenceAliasTargets,
    indexed_generation: u64,
    include_local_scope: bool,
) -> Result<(), String> {
    if aliases.is_empty() && !include_local_scope {
        return Ok(());
    }
    if !include_local_scope && !content_may_reference_aliases(path, content, aliases) {
        return Ok(());
    }
    let mut symbol_statement = connection
        .prepare(
            "insert or replace into workspace_symbol_references (
                root_path, path, reference_id, symbol_id, name, kind, container,
                line, column, end_line, end_column, confidence, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, 'identifier', null, ?6, ?7, ?6, ?8, ?9, ?10)",
        )
        .map_err(|error| error.to_string())?;
    let mut local_statement = connection
        .prepare(
            "insert or replace into workspace_local_symbol_references (
                root_path, path, reference_id, name, kind,
                line, column, end_line, end_column, confidence, indexed_generation
             ) values (?1, ?2, ?3, ?4, 'identifier', ?5, ?6, ?5, ?7, 'localScope', ?8)",
        )
        .map_err(|error| error.to_string())?;
    for (line_index, line) in content.lines().enumerate() {
        if is_declaration_like_line(line) {
            continue;
        }
        for token in identifier_tokens(line) {
            if is_keyword(token.name) {
                continue;
            }
            let symbol_id = aliases
                .get(&(path.to_string(), token.name.to_string()))
                .cloned();
            if symbol_id.is_some() {
                insert_identifier_reference(
                    &mut symbol_statement,
                    root_key,
                    path,
                    &token,
                    line_index as i64 + 1,
                    symbol_id,
                    indexed_generation,
                )?;
            } else if include_local_scope {
                insert_local_identifier_reference(
                    &mut local_statement,
                    root_key,
                    path,
                    &token,
                    line_index as i64 + 1,
                    indexed_generation,
                )?;
            }
        }
    }
    Ok(())
}

pub(crate) fn content_may_reference_aliases(
    path: &str,
    content: &str,
    aliases: &ReferenceAliasTargets,
) -> bool {
    aliases
        .keys()
        .any(|(alias_path, alias_name)| alias_path == path && content.contains(alias_name))
}

fn insert_identifier_reference(
    statement: &mut Statement<'_>,
    root_key: &str,
    path: &str,
    token: &IdentifierToken<'_>,
    line: i64,
    symbol_id: Option<String>,
    indexed_generation: u64,
) -> Result<(), String> {
    let column = token.column as i64;
    let end_column = token.end_column as i64;
    statement
        .execute(params![
            root_key,
            path,
            format!("{path}:{}:{}:{}", token.name, line, column),
            symbol_id,
            token.name,
            line,
            column,
            end_column,
            "resolvedAlias",
            indexed_generation as i64,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_local_identifier_reference(
    statement: &mut Statement<'_>,
    root_key: &str,
    path: &str,
    token: &IdentifierToken<'_>,
    line: i64,
    indexed_generation: u64,
) -> Result<(), String> {
    let column = token.column as i64;
    let end_column = token.end_column as i64;
    statement
        .execute(params![
            root_key,
            path,
            format!("{path}:local:{}:{}:{}", token.name, line, column),
            token.name,
            line,
            column,
            end_column,
            indexed_generation as i64,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn identifier_tokens(line: &str) -> Vec<IdentifierToken<'_>> {
    let bytes = line.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if !is_identifier_start(bytes[index]) {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < bytes.len() && is_identifier_part(bytes[index]) {
            index += 1;
        }
        if let Some(name) = line.get(start..index) {
            tokens.push(IdentifierToken {
                name,
                column: start + 1,
                end_column: index + 1,
            });
        }
    }
    tokens
}

fn is_identifier_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_' || value == b'$'
}

fn is_identifier_part(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}

fn is_keyword(value: &str) -> bool {
    matches!(
        value,
        "as" | "class" | "const" | "export" | "from" | "import" | "let" | "new"
    )
}

fn is_declaration_like_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("import ") || trimmed.starts_with("export ")
}

struct IdentifierToken<'a> {
    name: &'a str,
    column: usize,
    end_column: usize,
}
