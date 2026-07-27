use std::collections::{BTreeMap, HashMap};
use std::fs;

use rusqlite::params;

use crate::models::language::UsageCaller;
use crate::services::workspace_index_query_path_service::{
    denormalize_index_path, normalize_index_path, open_index_store,
};
use crate::services::workspace_reference_query_service::WorkspaceSymbolReferenceRow;

#[derive(Debug)]
struct CallableDeclaration {
    symbol_id: String,
    name: String,
    qualified_name: String,
    kind: String,
    line: i64,
    column: i64,
}

#[derive(Debug)]
struct CallableScope {
    declaration: CallableDeclaration,
    end_line: i64,
}

pub(crate) struct UsageReferenceContext {
    pub caller: Option<UsageCaller>,
    pub preview: String,
}

pub(crate) fn resolve_usage_reference_contexts(
    root_path: &str,
    references: &[WorkspaceSymbolReferenceRow],
) -> Result<HashMap<String, UsageReferenceContext>, String> {
    let mut references_by_path: BTreeMap<&str, Vec<&WorkspaceSymbolReferenceRow>> = BTreeMap::new();
    for reference in references {
        references_by_path
            .entry(reference.path.as_str())
            .or_default()
            .push(reference);
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut contexts = HashMap::new();
    for (path, path_references) in references_by_path {
        let declarations = query_callable_declarations(&connection, &root_key, path)?;
        let Ok(content) = fs::read_to_string(denormalize_index_path(path)) else {
            continue;
        };
        let scopes = callable_scopes(declarations, &content);
        let lines = content.lines().collect::<Vec<_>>();
        for reference in path_references {
            let caller = innermost_scope(&scopes, reference.line)
                .map(|scope| usage_caller(&scope.declaration));
            let preview = lines
                .get(reference.line.saturating_sub(1) as usize)
                .map(|line| line.trim().to_string())
                .unwrap_or_default();
            contexts.insert(
                reference.reference_id.clone(),
                UsageReferenceContext { caller, preview },
            );
        }
    }
    Ok(contexts)
}

fn query_callable_declarations(
    connection: &rusqlite::Connection,
    root_key: &str,
    path: &str,
) -> Result<Vec<CallableDeclaration>, String> {
    let mut statement = connection
        .prepare(
            "select symbol_id, name, qualified_name, kind, line, column
             from workspace_resolved_symbols
             where root_path = ?1 and path = ?2 and source = 'project'
               and kind in ('function', 'method')
             order by line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, path], |row| {
            Ok(CallableDeclaration {
                symbol_id: row.get(0)?,
                name: row.get(1)?,
                qualified_name: row.get(2)?,
                kind: row.get(3)?,
                line: row.get(4)?,
                column: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn callable_scopes(declarations: Vec<CallableDeclaration>, content: &str) -> Vec<CallableScope> {
    let pairs = structural_brace_pairs(content);
    let declaration_lines = declarations
        .iter()
        .map(|declaration| declaration.line)
        .collect::<Vec<_>>();
    declarations
        .into_iter()
        .enumerate()
        .filter_map(|(index, declaration)| {
            let next_line = declaration_lines.get(index + 1).copied();
            let end_line = scope_end_line(&pairs, declaration.line, next_line)?;
            Some(CallableScope {
                declaration,
                end_line,
            })
        })
        .collect()
}

fn scope_end_line(
    pairs: &[(i64, i64)],
    start_line: i64,
    next_declaration_line: Option<i64>,
) -> Option<i64> {
    pairs
        .iter()
        .filter(|(open_line, _)| {
            *open_line >= start_line
                && next_declaration_line.is_none_or(|next_line| *open_line < next_line)
        })
        .min_by_key(|(open_line, end_line)| (*open_line, std::cmp::Reverse(*end_line)))
        .map(|(_, end_line)| *end_line)
}

fn innermost_scope(scopes: &[CallableScope], line: i64) -> Option<&CallableScope> {
    scopes
        .iter()
        .filter(|scope| scope.declaration.line <= line && line <= scope.end_line)
        .max_by_key(|scope| (scope.declaration.line, scope.declaration.column))
}

fn usage_caller(declaration: &CallableDeclaration) -> UsageCaller {
    UsageCaller {
        symbol_id: declaration.symbol_id.clone(),
        name: declaration.name.clone(),
        qualified_name: declaration.qualified_name.clone(),
        kind: declaration.kind.clone(),
        line: u32::try_from(declaration.line).unwrap_or_default(),
        column: u32::try_from(declaration.column).unwrap_or_default(),
    }
}

fn structural_brace_pairs(content: &str) -> Vec<(i64, i64)> {
    let mut stack = Vec::new();
    let mut pairs = Vec::new();
    let mut quote = None;
    let mut escaped = false;
    let mut block_comment = false;
    let mut line_comment = false;
    let bytes = content.as_bytes();
    let mut line = 1_i64;
    let mut index = 0;
    while index < bytes.len() {
        let value = bytes[index];
        let next = bytes.get(index + 1).copied();
        if value == b'\n' {
            line += 1;
            line_comment = false;
            escaped = false;
            index += 1;
            continue;
        }
        if line_comment {
            index += 1;
            continue;
        }
        if block_comment {
            if value == b'*' && next == Some(b'/') {
                block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if value == b'\\' {
                escaped = true;
            } else if value == delimiter {
                quote = None;
            }
            index += 1;
            continue;
        }
        match (value, next) {
            (b'/', Some(b'/')) => {
                line_comment = true;
                index += 2;
            }
            (b'/', Some(b'*')) => {
                block_comment = true;
                index += 2;
            }
            (b'\'', _) | (b'"', _) | (b'`', _) => {
                quote = Some(value);
                index += 1;
            }
            (b'{', _) => {
                stack.push(line);
                index += 1;
            }
            (b'}', _) => {
                if let Some(open_line) = stack.pop() {
                    pairs.push((open_line, line));
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    pairs
}
