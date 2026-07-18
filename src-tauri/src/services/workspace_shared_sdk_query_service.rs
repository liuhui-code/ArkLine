use std::collections::HashSet;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_shared_sdk_posting_service::shared_sdk_symbol_trigrams;

pub fn query_name_candidates(
    connection: &Connection,
    artifact_key: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let candidate_limit = limit.min(512);
    let prefix = format!("{}%", escape_like_pattern(&normalized));
    let mut symbols = query_symbols(
        connection,
        "select kind, name, path, line, column, container, signature
         from shared_sdk_symbols
         where artifact_key = ?1
           and (normalized_name like ?2 escape '\\'
                or acronym like ?2 escape '\\')
         order by case when normalized_name = ?3 then 0
                       when normalized_name like ?2 escape '\\' then 1
                       else 2 end,
                  name, kind, path, line
         limit ?4",
        params![artifact_key, prefix, normalized, candidate_limit as i64],
    )?;
    if normalized.chars().count() >= 3 && symbols.len() < candidate_limit {
        let remaining = candidate_limit - symbols.len();
        let ids = trigram_candidate_ids(connection, artifact_key, &normalized, remaining)?;
        symbols.extend(symbols_by_ids(connection, artifact_key, &ids)?);
    }
    dedupe_symbols(&mut symbols);
    symbols.truncate(candidate_limit);
    Ok(symbols)
}

pub fn query_prefix_candidates(
    connection: &Connection,
    artifact_key: &str,
    prefix: &str,
    container: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    if prefix.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let name_pattern = format!("{}%", escape_like_pattern(&prefix.to_lowercase()));
    let container = container.unwrap_or_default();
    let container_suffix = format!("%.{}", escape_like_pattern(container));
    query_symbols(
        connection,
        "select kind, name, path, line, column, container, signature
         from shared_sdk_symbols
         where artifact_key = ?1
           and normalized_name like ?2 escape '\\'
           and (?3 = '' or container = ?3 or container like ?4 escape '\\')
         order by name, kind, path, line
         limit ?5",
        params![
            artifact_key,
            name_pattern,
            container,
            container_suffix,
            limit as i64
        ],
    )
}

pub fn query_by_symbol_id(
    connection: &Connection,
    artifact_key: &str,
    symbol_id: &str,
) -> Result<Option<WorkspaceSdkSymbol>, String> {
    connection
        .query_row(
            "select kind, name, path, line, column, container, signature
             from shared_sdk_symbols
             where artifact_key = ?1 and symbol_id = ?2
             limit 1",
            params![artifact_key, symbol_id],
            map_symbol,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn query_exact(
    connection: &Connection,
    artifact_key: &str,
    kind: &str,
    name: &str,
    container: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    query_symbols(
        connection,
        "select kind, name, path, line, column, container, signature
         from shared_sdk_symbols
         where artifact_key = ?1 and kind = ?2 and name = ?3
           and coalesce(container, '') = ?4
         order by path, line, column
         limit ?5",
        params![
            artifact_key,
            kind,
            name,
            container.unwrap_or_default(),
            limit as i64
        ],
    )
}

pub fn count_symbols(connection: &Connection, artifact_key: &str) -> Result<i64, String> {
    connection
        .query_row(
            "select count(*) from shared_sdk_symbols where artifact_key = ?1",
            [artifact_key],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

pub fn query_members(
    connection: &Connection,
    artifact_key: &str,
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    query_symbols(
        connection,
        "select kind, name, path, line, column, container, signature
         from shared_sdk_symbols
         where artifact_key = ?1 and container is not null
         order by name, container, path, line",
        [artifact_key],
    )
}

fn query_symbols<P: rusqlite::Params>(
    connection: &Connection,
    sql: &str,
    params: P,
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params, map_symbol)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn trigram_candidate_ids(
    connection: &Connection,
    artifact_key: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let trigrams = shared_sdk_symbol_trigrams(query);
    if trigrams.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let placeholders = (0..trigrams.len())
        .map(|index| format!("?{}", index + 2))
        .collect::<Vec<_>>()
        .join(",");
    let limit_index = trigrams.len() + 2;
    let sql = format!(
        "select symbol_id
         from shared_sdk_symbol_trigrams
         where artifact_key = ?1 and trigram in ({placeholders})
         group by symbol_id
         order by count(*) desc, symbol_id
         limit ?{limit_index}"
    );
    let mut values = Vec::with_capacity(trigrams.len() + 2);
    values.push(Value::Text(artifact_key.to_string()));
    values.extend(trigrams.into_iter().map(Value::Text));
    values.push(Value::Integer(limit as i64));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn symbols_by_ids(
    connection: &Connection,
    artifact_key: &str,
    ids: &[String],
) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = (0..ids.len())
        .map(|index| format!("?{}", index + 2))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "select kind, name, path, line, column, container, signature
         from shared_sdk_symbols
         where artifact_key = ?1 and symbol_id in ({placeholders})"
    );
    let mut values = Vec::with_capacity(ids.len() + 1);
    values.push(Value::Text(artifact_key.to_string()));
    values.extend(ids.iter().cloned().map(Value::Text));
    query_symbols(connection, &sql, params_from_iter(values.iter()))
}

fn dedupe_symbols(symbols: &mut Vec<WorkspaceSdkSymbol>) {
    let mut seen = HashSet::new();
    symbols.retain(|symbol| {
        seen.insert((
            symbol.kind.clone(),
            symbol.name.clone(),
            symbol.path.clone(),
            symbol.line,
            symbol.column,
        ))
    });
}

fn map_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSdkSymbol> {
    let line: i64 = row.get(3)?;
    let column: i64 = row.get(4)?;
    Ok(WorkspaceSdkSymbol {
        kind: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        line: usize::try_from(line).unwrap_or_default(),
        column: usize::try_from(column).unwrap_or_default(),
        container: row.get(5)?,
        signature: row.get(6)?,
    })
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
