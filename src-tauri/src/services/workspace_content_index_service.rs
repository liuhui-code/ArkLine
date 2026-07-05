use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Statement};

use crate::models::workspace::{
    WorkspaceTextSearchContextLine, WorkspaceTextSearchMatch, WorkspaceTextSearchQuery,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_content_query_service::{load_candidate_lines, IndexedLine};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

pub fn index_workspace_content(root_path: &str, indexed_paths: &[String]) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let mut connection = open_content_index(root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "delete from workspace_content_lines where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "delete from workspace_content_fts where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;

    index_paths(&transaction, root_path, &root_key, indexed_paths)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn update_workspace_content(
    root_path: &str,
    added_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let mut connection = open_content_index(root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for path in removed_paths {
        delete_indexed_path(&transaction, &root_key, path)?;
    }
    for path in added_paths {
        if content_path_exists(&transaction, &root_key, path)? {
            delete_indexed_path(&transaction, &root_key, path)?;
        }
    }

    index_paths(&transaction, root_path, &root_key, added_paths)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn search_indexed_workspace_content(
    request: &WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    let query = request.query.trim();
    let result_query = WorkspaceTextSearchQuery::Text {
        query: query.to_string(),
    };
    if query.is_empty() {
        return Ok(WorkspaceTextSearchResult {
            query: result_query,
            matches: Vec::new(),
        });
    }

    let connection = open_content_index(&request.root_path)?;
    ensure_schema(&connection)?;
    let root_key = normalize_index_path(&request.root_path);
    let lines = load_candidate_lines(
        &connection,
        &root_key,
        query,
        request.options.case_sensitive,
        request.limit,
    )?;
    let grouped_lines = load_context_lines(&connection, &root_key, &lines)?;
    let mut matches = Vec::new();

    for line in lines {
        let Some((start, end)) = find_line_match(&line.text, query, request.options.case_sensitive)
        else {
            continue;
        };
        let context_lines = grouped_lines.get(&line.path).cloned().unwrap_or_default();
        let line_index = line.line_number.saturating_sub(1);

        let file_path = to_filesystem_path(&request.root_path, &line.path);
        matches.push(WorkspaceTextSearchMatch {
            path: file_path.clone(),
            relative_path: relative_workspace_path(&request.root_path, &file_path),
            file_name: file_name(&file_path),
            line: line.line_number,
            column: start + 1,
            summary: build_summary(&line.text, start, end),
            preview: line.text.clone(),
            preview_start: start,
            preview_end: end,
            context_before: slice_context(
                &context_lines,
                line_index.saturating_sub(request.context_lines),
                line_index,
            ),
            context_after: slice_context(
                &context_lines,
                line_index + 1,
                line_index + 1 + request.context_lines,
            ),
        });
        if matches.len() >= request.limit {
            break;
        }
    }

    Ok(WorkspaceTextSearchResult {
        query: result_query,
        matches,
    })
}

fn open_content_index(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace content index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(&cache_path).map_err(|error| error.to_string())
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    ensure_workspace_index_schema(connection)
}

fn delete_indexed_path(connection: &Connection, root_key: &str, path: &str) -> Result<(), String> {
    let normalized_path = normalize_index_path(path);
    connection
        .execute(
            "delete from workspace_content_lines where root_path = ?1 and path = ?2",
            params![root_key, normalized_path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_content_fts where root_path = ?1 and path = ?2",
            params![root_key, normalized_path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn content_path_exists(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<bool, String> {
    let normalized_path = normalize_index_path(path);
    let count: i64 = connection
        .query_row(
            "select count(*)
             from workspace_content_lines
             where root_path = ?1 and path = ?2
             limit 1",
            params![root_key, normalized_path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

fn index_paths(
    connection: &Connection,
    root_path: &str,
    root_key: &str,
    indexed_paths: &[String],
) -> Result<(), String> {
    let mut line_statement = connection
        .prepare(
            "insert into workspace_content_lines (
                root_path, path, line, text
             ) values (?1, ?2, ?3, ?4)",
        )
        .map_err(|error| error.to_string())?;
    let mut fts_statement = connection
        .prepare(
            "insert into workspace_content_fts (
                root_path, path, line, text
             ) values (?1, ?2, ?3, ?4)",
        )
        .map_err(|error| error.to_string())?;
    for indexed_path in indexed_paths {
        let file_path = to_filesystem_path(root_path, indexed_path);
        let Ok(content) = fs::read_to_string(&file_path) else {
            continue;
        };

        let normalized_path = normalize_index_path(indexed_path);
        for (line_index, line_text) in content.lines().enumerate() {
            insert_indexed_line(
                &mut line_statement,
                &mut fts_statement,
                root_key,
                &normalized_path,
                line_index,
                line_text,
            )?;
        }
    }
    Ok(())
}

fn insert_indexed_line(
    line_statement: &mut Statement<'_>,
    fts_statement: &mut Statement<'_>,
    root_key: &str,
    path: &str,
    line_index: usize,
    line_text: &str,
) -> Result<(), String> {
    line_statement
        .execute(params![root_key, path, (line_index + 1) as i64, line_text])
        .map_err(|error| error.to_string())?;
    fts_statement
        .execute(params![root_key, path, (line_index + 1) as i64, line_text])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_context_lines(
    connection: &Connection,
    root_key: &str,
    matches: &[IndexedLine],
) -> Result<HashMap<String, Vec<String>>, String> {
    let mut grouped = HashMap::new();
    for matched_line in matches {
        if grouped.contains_key(&matched_line.path) {
            continue;
        }

        let mut statement = connection
            .prepare(
                "select text
                 from workspace_content_lines
                 where root_path = ?1 and path = ?2
                 order by line",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![root_key, matched_line.path], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| error.to_string())?;
        let lines = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        grouped.insert(matched_line.path.clone(), lines);
    }
    Ok(grouped)
}

fn find_line_match(line_text: &str, query: &str, case_sensitive: bool) -> Option<(usize, usize)> {
    let search_line = if case_sensitive {
        line_text.to_string()
    } else {
        line_text.to_lowercase()
    };
    let search_query = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let start = search_line.find(&search_query)?;
    Some((start, start + search_query.len()))
}

fn build_summary(line_text: &str, start: usize, end: usize) -> String {
    let summary_radius = 18;
    let summary_start = previous_char_boundary(line_text, start.saturating_sub(summary_radius));
    let summary_end =
        next_char_boundary(line_text, usize::min(line_text.len(), end + summary_radius));
    let prefix = if summary_start > 0 { "..." } else { "" };
    let suffix = if summary_end < line_text.len() {
        "..."
    } else {
        ""
    };
    format!(
        "{prefix}{}{suffix}",
        line_text[summary_start..summary_end].trim()
    )
}

fn previous_char_boundary(value: &str, index: usize) -> usize {
    let mut boundary = usize::min(index, value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

fn next_char_boundary(value: &str, index: usize) -> usize {
    let mut boundary = usize::min(index, value.len());
    while boundary < value.len() && !value.is_char_boundary(boundary) {
        boundary += 1;
    }
    boundary
}

fn slice_context(
    lines: &[String],
    start: usize,
    end: usize,
) -> Vec<WorkspaceTextSearchContextLine> {
    let mut context = Vec::new();
    for index in start..usize::min(lines.len(), end) {
        context.push(WorkspaceTextSearchContextLine {
            line: index + 1,
            text: lines[index].clone(),
        });
    }
    context
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        return indexed_path.to_string();
    }

    if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}

fn relative_workspace_path(root_path: &str, path: &str) -> String {
    let normalized_root = root_path
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let normalized_path = path.replace('\\', "/");
    let root_prefix = format!("{normalized_root}/");

    if normalized_path.starts_with(&root_prefix) {
        normalized_path[root_prefix.len()..].to_string()
    } else {
        normalized_path
    }
}

fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
