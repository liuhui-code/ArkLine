use rusqlite::{params, Connection};

#[derive(Debug, Clone)]
pub struct IndexedLine {
    pub path: String,
    pub line_number: usize,
    pub text: String,
}

pub fn load_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    case_sensitive: bool,
    limit: usize,
) -> Result<Vec<IndexedLine>, String> {
    if !case_sensitive {
        let fts_lines = load_fts_candidate_lines(connection, root_key, query, limit)?;
        if !fts_lines.is_empty() {
            return Ok(fts_lines);
        }
    }

    load_like_candidate_lines(connection, root_key, query, case_sensitive, limit)
}

fn load_fts_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<IndexedLine>, String> {
    let Some(fts_query) = build_fts_query(query) else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "select path, line, text
             from workspace_content_fts
             where root_path = ?1 and workspace_content_fts match ?2
             order by bm25(workspace_content_fts), path, line
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, fts_query, limit as i64], |row| {
            let line_number: i64 = row.get(1)?;
            Ok(IndexedLine {
                path: row.get(0)?,
                line_number: usize::try_from(line_number).unwrap_or_default(),
                text: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_like_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    case_sensitive: bool,
    limit: usize,
) -> Result<Vec<IndexedLine>, String> {
    let pattern = format!("%{}%", escape_like_pattern(&query.to_lowercase()));
    let mut statement = connection
        .prepare(
            "select path, line, text
             from workspace_content_lines
             where root_path = ?1 and lower(text) like ?2 escape '\\'
             order by path, line
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let query_limit = if case_sensitive {
        limit.saturating_mul(8).max(limit)
    } else {
        limit
    };
    let rows = statement
        .query_map(params![root_key, pattern, query_limit as i64], |row| {
            let line_number: i64 = row.get(1)?;
            Ok(IndexedLine {
                path: row.get(0)?,
                line_number: usize::try_from(line_number).unwrap_or_default(),
                text: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut lines = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if case_sensitive {
        lines.retain(|line| line.text.contains(query));
        lines.truncate(limit);
    }
    Ok(lines)
}

fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        if matches!(character, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn build_fts_query(query: &str) -> Option<String> {
    let terms = query
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|term| !term.is_empty())
        .map(|term| format!("{}*", escape_fts_term(term)))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn escape_fts_term(term: &str) -> String {
    term.chars()
        .filter(|character| character.is_alphanumeric() || *character == '_')
        .collect()
}
