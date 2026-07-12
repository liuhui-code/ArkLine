use crate::models::workspace::WorkspaceTextSearchContextLine;

pub(crate) fn find_line_match(
    line_text: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
) -> Option<(usize, usize)> {
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
    let mut start = search_line.find(&search_query);
    while let Some(start_index) = start {
        let end_index = start_index + search_query.len();
        if !whole_word || is_whole_word_boundary(line_text, start_index, end_index) {
            return Some((start_index, end_index));
        }
        start = search_line[start_index + 1..]
            .find(&search_query)
            .map(|offset| start_index + 1 + offset);
    }
    None
}

pub(crate) fn build_summary(line_text: &str, start: usize, end: usize) -> String {
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

pub(crate) fn slice_context(
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
