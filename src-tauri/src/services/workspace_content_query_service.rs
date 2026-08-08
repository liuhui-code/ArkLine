use rusqlite::{params, Connection};

#[derive(Debug, Clone)]
pub struct IndexedLine {
    pub path: String,
    pub line_number: usize,
    pub text: String,
}

pub struct IndexedCandidatePage {
    pub lines: Vec<IndexedLine>,
    pub partial: bool,
}

pub fn load_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    case_sensitive: bool,
    limit: usize,
    offset: usize,
) -> Result<IndexedCandidatePage, String> {
    if !case_sensitive {
        if query.chars().count() >= 3 {
            let mut lines =
                load_trigram_candidate_lines(connection, root_key, query, limit, offset)?;
            let partial = content_substring_is_partial(connection, root_key)?;
            if partial && lines.len() < limit {
                let tokens = load_fts_candidate_lines(connection, root_key, query, limit, offset)?;
                append_unique(&mut lines, tokens, limit);
            }
            return Ok(IndexedCandidatePage { lines, partial });
        }
        let fts_lines = load_fts_candidate_lines(connection, root_key, query, limit, offset)?;
        if !fts_lines.is_empty() {
            return Ok(IndexedCandidatePage {
                lines: fts_lines,
                partial: false,
            });
        }
    }

    load_like_candidate_lines(connection, root_key, query, case_sensitive, limit, offset).map(
        |lines| IndexedCandidatePage {
            lines,
            partial: false,
        },
    )
}

fn content_substring_is_partial(connection: &Connection, root_key: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(
                select 1 from workspace_content_substring_files
                where root_path = ?1 and status = 'pending'
             )",
            [root_key],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn append_unique(target: &mut Vec<IndexedLine>, source: Vec<IndexedLine>, limit: usize) {
    for line in source {
        let duplicate = target
            .iter()
            .any(|item| item.path == line.path && item.line_number == line.line_number);
        if !duplicate {
            target.push(line);
        }
        if target.len() >= limit {
            break;
        }
    }
}

fn load_trigram_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<IndexedLine>, String> {
    if query.chars().count() < 3 {
        return Ok(Vec::new());
    }
    let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut statement = connection
        .prepare(
            "select trigram.path, trigram.line, trigram.text
             from workspace_content_trigram_fts trigram
             join workspace_content_substring_files substring
               on substring.root_path = trigram.root_path and substring.path = trigram.path
             join workspace_content_files core
               on core.root_path = trigram.root_path and core.path = trigram.path
             where trigram.root_path = ?1 and workspace_content_trigram_fts match ?2
               and substring.status = 'ready'
               and substring.indexed_generation = core.indexed_generation
             order by trigram.rowid
             limit ?3 offset ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, fts_query, limit as i64, offset as i64],
            |row| {
                let line_number: i64 = row.get(1)?;
                Ok(IndexedLine {
                    path: row.get(0)?,
                    line_number: usize::try_from(line_number).unwrap_or_default(),
                    text: row.get(2)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_fts_candidate_lines(
    connection: &Connection,
    root_key: &str,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<IndexedLine>, String> {
    let Some(fts_query) = build_fts_query(query) else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "select path, line, text
             from workspace_content_fts
             where root_path = ?1 and workspace_content_fts match ?2
             order by rowid
             limit ?3 offset ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![root_key, fts_query, limit as i64, offset as i64],
            |row| {
                let line_number: i64 = row.get(1)?;
                Ok(IndexedLine {
                    path: row.get(0)?,
                    line_number: usize::try_from(line_number).unwrap_or_default(),
                    text: row.get(2)?,
                })
            },
        )
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
    offset: usize,
) -> Result<Vec<IndexedLine>, String> {
    let pattern = format!("%{}%", escape_like_pattern(&query.to_lowercase()));
    let mut statement = connection
        .prepare(
            "select path, line, text
             from workspace_content_lines
             where root_path = ?1 and lower(text) like ?2 escape '\\'
             order by path, line
             limit ?3 offset ?4",
        )
        .map_err(|error| error.to_string())?;
    let query_offset = if case_sensitive { 0 } else { offset };
    let query_limit = if case_sensitive {
        offset
            .saturating_add(limit)
            .saturating_mul(8)
            .max(offset + limit)
    } else {
        limit
    };
    let rows = statement
        .query_map(
            params![root_key, pattern, query_limit as i64, query_offset as i64],
            |row| {
                let line_number: i64 = row.get(1)?;
                Ok(IndexedLine {
                    path: row.get(0)?,
                    line_number: usize::try_from(line_number).unwrap_or_default(),
                    text: row.get(2)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;

    let mut lines = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if case_sensitive {
        lines.retain(|line| line.text.contains(query));
        lines = lines.into_iter().skip(offset).collect();
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
