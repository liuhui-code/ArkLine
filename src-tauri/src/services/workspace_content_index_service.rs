use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params_from_iter, Connection};

use crate::models::workspace::{
    WorkspaceTextSearchCursor, WorkspaceTextSearchMatch, WorkspaceTextSearchQuery,
    WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
};
use crate::services::workspace_content_match_service::{
    build_summary, find_line_match, slice_context,
};
use crate::services::workspace_content_query_service::{load_candidate_lines, IndexedLine};
use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;

#[cfg(test)]
pub use crate::services::workspace_content_refresh_service::{
    index_workspace_content, update_workspace_content,
};

struct MatchedIndexedLine {
    line: IndexedLine,
    start: usize,
    end: usize,
}

pub fn search_indexed_workspace_content(
    request: &WorkspaceTextSearchRequest,
) -> Result<WorkspaceTextSearchResult, String> {
    search_indexed_workspace_content_with_cancellation(request, || false)
}

pub fn search_indexed_workspace_content_with_cancellation<F>(
    request: &WorkspaceTextSearchRequest,
    mut is_cancelled: F,
) -> Result<WorkspaceTextSearchResult, String>
where
    F: FnMut() -> bool + Send + 'static,
{
    let query = request.query.trim();
    let result_query = WorkspaceTextSearchQuery::Text {
        query: query.to_string(),
    };
    if query.is_empty() {
        return Ok(WorkspaceTextSearchResult {
            query: result_query,
            matches: Vec::new(),
            partial: false,
            searched_files: 0,
            prefilter_skipped_files: 0,
            limit_reached: false,
            next_cursor: None,
        });
    }

    let Some(connection) = open_existing_workspace_index_reader(&request.root_path)? else {
        return Ok(empty_text_search_result(result_query));
    };
    if is_cancelled() {
        return Err("Workspace text search cancelled".to_string());
    }
    connection.progress_handler(1_000, Some(is_cancelled));
    let result =
        search_indexed_workspace_content_on_connection(&connection, request, query, result_query);
    connection.progress_handler(0, None::<fn() -> bool>);
    result.map_err(normalize_search_error)
}

fn search_indexed_workspace_content_on_connection(
    connection: &Connection,
    request: &WorkspaceTextSearchRequest,
    query: &str,
    result_query: WorkspaceTextSearchQuery,
) -> Result<WorkspaceTextSearchResult, String> {
    let root_key = normalize_index_path(&request.root_path);
    let offset = request
        .cursor
        .as_ref()
        .map_or(0, |cursor| cursor.path_index);
    let scan_limit = indexed_candidate_scan_limit(request);
    let candidate_lines = load_candidate_lines(
        connection,
        &root_key,
        query,
        request.options.case_sensitive,
        scan_limit + 1,
        offset,
    )?;
    let loaded_candidate_count = candidate_lines.len();
    let searched_files = candidate_lines
        .iter()
        .map(|line| line.path.as_str())
        .collect::<HashSet<_>>()
        .len();
    let mut consumed_candidates = 0;
    let mut visible_lines = Vec::new();
    for line in candidate_lines.into_iter().take(scan_limit) {
        consumed_candidates += 1;
        let Some((start, end)) = find_line_match(
            &line.text,
            query,
            request.options.case_sensitive,
            request.options.whole_word,
        ) else {
            continue;
        };
        visible_lines.push(MatchedIndexedLine { line, start, end });
        if visible_lines.len() >= request.limit {
            break;
        }
    }
    let limit_reached = loaded_candidate_count > consumed_candidates;
    let context_sources = visible_lines
        .iter()
        .map(|matched| matched.line.clone())
        .collect::<Vec<_>>();
    let grouped_lines = if request.context_lines == 0 {
        HashMap::new()
    } else {
        load_context_lines(connection, &root_key, &context_sources)?
    };
    let mut matches = Vec::new();

    for matched in visible_lines {
        let line = matched.line;
        let context_lines = grouped_lines.get(&line.path).cloned().unwrap_or_default();
        let line_index = line.line_number.saturating_sub(1);

        let file_path = to_filesystem_path(&request.root_path, &line.path);
        matches.push(WorkspaceTextSearchMatch {
            path: file_path.clone(),
            relative_path: relative_workspace_path(&request.root_path, &file_path),
            file_name: file_name(&file_path),
            line: line.line_number,
            column: matched.start + 1,
            summary: build_summary(&line.text, matched.start, matched.end),
            preview: line.text.clone(),
            preview_start: matched.start,
            preview_end: matched.end,
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
    }

    Ok(WorkspaceTextSearchResult {
        query: result_query,
        matches,
        partial: limit_reached,
        searched_files,
        prefilter_skipped_files: 0,
        limit_reached,
        next_cursor: limit_reached.then_some(WorkspaceTextSearchCursor {
            path_index: offset + consumed_candidates,
            line_index: 0,
            source: Some("indexed".to_string()),
        }),
    })
}

fn normalize_search_error(error: String) -> String {
    if error.to_lowercase().contains("interrupted") {
        "Workspace text search cancelled".to_string()
    } else {
        error
    }
}

fn empty_text_search_result(query: WorkspaceTextSearchQuery) -> WorkspaceTextSearchResult {
    WorkspaceTextSearchResult {
        query,
        matches: Vec::new(),
        partial: false,
        searched_files: 0,
        prefilter_skipped_files: 0,
        limit_reached: false,
        next_cursor: None,
    }
}

fn load_context_lines(
    connection: &Connection,
    root_key: &str,
    matches: &[IndexedLine],
) -> Result<HashMap<String, Vec<String>>, String> {
    let paths = matches
        .iter()
        .map(|line| line.path.as_str())
        .collect::<HashSet<_>>();
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = (2..paths.len() + 2)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "select path, text
         from workspace_content_lines
         where root_path = ?1 and path in ({placeholders})
         order by path, line"
    );
    let parameters = std::iter::once(root_key).chain(paths.iter().copied());
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(parameters), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut grouped = HashMap::new();
    for row in rows {
        let (path, text) = row.map_err(|error| error.to_string())?;
        grouped.entry(path).or_insert_with(Vec::new).push(text);
    }
    Ok(grouped)
}

fn indexed_candidate_scan_limit(request: &WorkspaceTextSearchRequest) -> usize {
    if request.options.whole_word {
        return request.limit.saturating_mul(8).max(request.limit + 1);
    }
    request.limit + 1
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
