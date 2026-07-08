use std::fs;
use std::path::Path;

use regex::RegexBuilder;

use crate::models::workspace::{
    WorkspaceTextSearchContextLine, WorkspaceTextSearchMatch, WorkspaceTextSearchOptions,
    WorkspaceTextSearchCursor, WorkspaceTextSearchQuery, WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
};

enum ParsedTextSearchQuery {
    Text(String),
    Regex(regex::Regex),
    Invalid(String),
}

pub fn search_workspace_text(
    request: &WorkspaceTextSearchRequest,
    indexed_paths: &[String],
) -> WorkspaceTextSearchResult {
    search_workspace_text_with_cancellation(request, indexed_paths, || false)
}

pub fn search_workspace_text_with_cancellation<F>(
    request: &WorkspaceTextSearchRequest,
    indexed_paths: &[String],
    mut is_cancelled: F,
) -> WorkspaceTextSearchResult
where
    F: FnMut() -> bool,
{
    let parsed_query = parse_search_query(&request.query, &request.options);
    let result_query = to_result_query(&request.query, &parsed_query);
    if matches!(parsed_query, ParsedTextSearchQuery::Invalid(_)) || request.query.trim().is_empty()
    {
        return WorkspaceTextSearchResult {
            query: result_query,
            matches: Vec::new(),
            partial: false,
            searched_files: 0,
            limit_reached: false,
            next_cursor: None,
        };
    }

    let mut matches = Vec::new();
    let mut searched_files = 0;
    let mut partial = false;
    let mut limit_reached = false;
    let mut next_cursor = None;
    let start_path_index = request
        .cursor
        .as_ref()
        .map_or(0, |cursor| cursor.path_index.min(indexed_paths.len()));
    for (path_index, indexed_path) in indexed_paths.iter().enumerate().skip(start_path_index) {
        if is_cancelled() {
            partial = true;
            break;
        }
        if matches.len() >= request.limit {
            partial = true;
            limit_reached = true;
            next_cursor = Some(WorkspaceTextSearchCursor {
                path_index,
                line_index: 0,
            });
            break;
        }

        let file_path = to_filesystem_path(&request.root_path, indexed_path);
        let Ok(content) = fs::read_to_string(&file_path) else {
            continue;
        };
        searched_files += 1;

        let lines = content.lines().map(str::to_string).collect::<Vec<_>>();
        let start_line_index = if path_index == start_path_index {
            request
                .cursor
                .as_ref()
                .map_or(0, |cursor| cursor.line_index.min(lines.len()))
        } else {
            0
        };
        let relative_path = relative_workspace_path(&request.root_path, indexed_path);
        let file_name = file_name(indexed_path);

        for (line_index, line_text) in lines.iter().enumerate().skip(start_line_index) {
            if matches.len() >= request.limit {
                partial = true;
                limit_reached = true;
                next_cursor = Some(WorkspaceTextSearchCursor {
                    path_index,
                    line_index,
                });
                break;
            }

            let Some((start, end)) = find_line_match(line_text, &parsed_query, &request.options)
            else {
                continue;
            };

            matches.push(WorkspaceTextSearchMatch {
                path: file_path.clone(),
                relative_path: relative_path.clone(),
                file_name: file_name.clone(),
                line: line_index + 1,
                column: start + 1,
                summary: build_summary(line_text, start, end),
                preview: line_text.clone(),
                preview_start: start,
                preview_end: end,
                context_before: slice_context(
                    &lines,
                    line_index.saturating_sub(request.context_lines),
                    line_index,
                ),
                context_after: slice_context(
                    &lines,
                    line_index + 1,
                    line_index + 1 + request.context_lines,
                ),
            });
        }
        if next_cursor.is_some() {
            break;
        }
    }

    WorkspaceTextSearchResult {
        query: result_query,
        matches,
        partial,
        searched_files,
        limit_reached,
        next_cursor,
    }
}

fn parse_search_query(query: &str, _options: &WorkspaceTextSearchOptions) -> ParsedTextSearchQuery {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return ParsedTextSearchQuery::Text(String::new());
    }

    let Some((source, flags)) = parse_regex_literal(trimmed) else {
        return ParsedTextSearchQuery::Text(trimmed.to_string());
    };

    let mut builder = RegexBuilder::new(&source);
    builder
        .case_insensitive(flags.contains('i'))
        .multi_line(flags.contains('m'))
        .dot_matches_new_line(flags.contains('s'));

    match builder.build() {
        Ok(expression) => ParsedTextSearchQuery::Regex(expression),
        Err(error) => ParsedTextSearchQuery::Invalid(error.to_string()),
    }
}

fn to_result_query(query: &str, parsed_query: &ParsedTextSearchQuery) -> WorkspaceTextSearchQuery {
    match parsed_query {
        ParsedTextSearchQuery::Text(value) => WorkspaceTextSearchQuery::Text {
            query: value.clone(),
        },
        ParsedTextSearchQuery::Regex(_) => WorkspaceTextSearchQuery::Regex {
            query: query.trim().to_string(),
        },
        ParsedTextSearchQuery::Invalid(message) => WorkspaceTextSearchQuery::Invalid {
            query: query.trim().to_string(),
            message: message.clone(),
        },
    }
}

fn parse_regex_literal(query: &str) -> Option<(String, String)> {
    if !query.starts_with('/') {
        return None;
    }

    let slash_index = query.rfind('/')?;
    if slash_index == 0 {
        return None;
    }

    let source = query[1..slash_index].to_string();
    let flags = query[slash_index + 1..].to_string();
    Some((source, flags))
}

fn find_line_match(
    line_text: &str,
    query: &ParsedTextSearchQuery,
    options: &WorkspaceTextSearchOptions,
) -> Option<(usize, usize)> {
    match query {
        ParsedTextSearchQuery::Text(search_query) => {
            let search_line = if options.case_sensitive {
                line_text.to_string()
            } else {
                line_text.to_lowercase()
            };
            let search_query = if options.case_sensitive {
                search_query.clone()
            } else {
                search_query.to_lowercase()
            };
            let mut start = search_line.find(&search_query);

            while let Some(start_index) = start {
                let end_index = start_index + search_query.len();
                if !options.whole_word || is_whole_word_boundary(line_text, start_index, end_index)
                {
                    return Some((start_index, end_index));
                }

                start = search_line[start_index + 1..]
                    .find(&search_query)
                    .map(|offset| start_index + 1 + offset);
            }
            None
        }
        ParsedTextSearchQuery::Regex(expression) => expression
            .find(line_text)
            .map(|match_range| (match_range.start(), match_range.end())),
        ParsedTextSearchQuery::Invalid(_) => None,
    }
}

fn is_whole_word_boundary(line_text: &str, start: usize, end: usize) -> bool {
    let left = if start > 0 {
        line_text[..start].chars().next_back()
    } else {
        None
    };
    let right = if end < line_text.len() {
        line_text[end..].chars().next()
    } else {
        None
    };

    !left.is_some_and(is_word_character) && !right.is_some_and(is_word_character)
}

fn is_word_character(value: char) -> bool {
    value == '_' || value.is_ascii_alphanumeric()
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
