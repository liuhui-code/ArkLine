use regex::{Regex, RegexBuilder};

use crate::models::device_log_query::{DeviceLogQueryRequest, DeviceLogQueryRow};

const DEVICE_LOG_REGEX_PATTERN_LIMIT: usize = 2_048;
const DEVICE_LOG_REGEX_COMPILED_SIZE_LIMIT: usize = 1 << 20;

pub(crate) enum DeviceLogTextMatcher {
    Empty,
    Plain { query: String, match_case: bool },
    Regex(Regex),
}

pub(crate) fn build_matcher(
    request: &DeviceLogQueryRequest,
) -> Result<DeviceLogTextMatcher, String> {
    if request.query.trim().is_empty() {
        return Ok(DeviceLogTextMatcher::Empty);
    }
    if request.regex {
        if request.query.chars().count() > DEVICE_LOG_REGEX_PATTERN_LIMIT {
            return Err(format!(
                "Device log regex is too long; use {DEVICE_LOG_REGEX_PATTERN_LIMIT} characters or fewer"
            ));
        }
        let regex = RegexBuilder::new(&request.query)
            .case_insensitive(!request.match_case)
            .size_limit(DEVICE_LOG_REGEX_COMPILED_SIZE_LIMIT)
            .build()
            .map_err(|error| format_device_log_regex_error(error))?;
        return Ok(DeviceLogTextMatcher::Regex(regex));
    }
    let query = if request.match_case {
        request.query.clone()
    } else {
        request.query.to_ascii_lowercase()
    };
    Ok(DeviceLogTextMatcher::Plain {
        query,
        match_case: request.match_case,
    })
}

fn format_device_log_regex_error(error: regex::Error) -> String {
    let message = error.to_string();
    if message.contains("Compiled regex exceeds size limit") {
        return "Device log regex is too complex; narrow the pattern".to_string();
    }
    format!("Invalid regular expression: {message}")
}

pub(crate) fn matches_page_scope(row: &DeviceLogQueryRow, request: &DeviceLogQueryRequest) -> bool {
    request
        .cursor_seq
        .is_none_or(|cursor_seq| row.seq < cursor_seq)
}

pub(crate) fn matches_structured_filters(
    row: &DeviceLogQueryRow,
    request: &DeviceLogQueryRequest,
) -> bool {
    (request.levels.is_empty() || request.levels.iter().any(|level| level == &row.level))
        && matches_pid(row.pid, &request.pid)
        && contains_filter(&row.process, &request.process, request.match_case)
        && contains_filter(&row.domain, &request.domain, request.match_case)
        && contains_filter(&row.tag, &request.tag, request.match_case)
}

pub(crate) fn matches_text(row: &DeviceLogQueryRow, matcher: &DeviceLogTextMatcher) -> bool {
    match matcher {
        DeviceLogTextMatcher::Empty => true,
        DeviceLogTextMatcher::Plain { query, match_case } => {
            if *match_case {
                row.raw.contains(query)
            } else {
                row.raw.to_ascii_lowercase().contains(query)
            }
        }
        DeviceLogTextMatcher::Regex(regex) => regex.is_match(&row.raw),
    }
}

fn contains_filter(value: &str, filter: &str, match_case: bool) -> bool {
    if filter.trim().is_empty() {
        return true;
    }
    if match_case {
        return value.contains(filter);
    }
    value
        .to_ascii_lowercase()
        .contains(&filter.to_ascii_lowercase())
}

fn matches_pid(value: Option<u64>, filter: &str) -> bool {
    let trimmed = filter.trim();
    if trimmed.is_empty() {
        return true;
    }
    trimmed
        .parse::<u64>()
        .ok()
        .is_some_and(|pid| value == Some(pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_matcher_respects_case_sensitive_queries() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "Width".to_string();
        request.match_case = true;
        let matcher = build_matcher(&request).expect("matcher");
        let row = make_row("Width changed");

        assert!(matches_text(&row, &matcher));
    }

    #[test]
    fn plain_matcher_rejects_case_mismatch_when_case_sensitive() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "Width".to_string();
        request.match_case = true;
        let matcher = build_matcher(&request).expect("matcher");
        let row = make_row("width changed");

        assert!(!matches_text(&row, &matcher));
    }

    #[test]
    fn plain_matcher_defaults_to_case_insensitive_queries() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "Width".to_string();
        let matcher = build_matcher(&request).expect("matcher");
        let row = make_row("width changed");

        assert!(matches_text(&row, &matcher));
    }

    #[test]
    fn regex_matcher_accepts_normal_patterns() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "width=\\d+".to_string();
        request.regex = true;
        let matcher = build_matcher(&request).expect("matcher");
        let row = make_row("layout width=42");

        assert!(matches_text(&row, &matcher));
    }

    #[test]
    fn regex_matcher_rejects_oversized_patterns_before_compilation() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.query = "a".repeat(2_049);
        request.regex = true;

        let error = match build_matcher(&request) {
            Ok(_) => panic!("oversized regex should be rejected"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "Device log regex is too long; use 2048 characters or fewer"
        );
    }

    #[test]
    fn structured_filters_reject_case_mismatch_when_case_sensitive() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.process = "Demo".to_string();
        request.match_case = true;
        let mut row = make_row("line");
        row.process = "demo".to_string();

        assert!(!matches_structured_filters(&row, &request));
    }

    #[test]
    fn structured_filters_default_to_case_insensitive_matching() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.process = "Demo".to_string();
        let mut row = make_row("line");
        row.process = "demo".to_string();

        assert!(matches_structured_filters(&row, &request));
    }

    #[test]
    fn structured_filters_match_exact_pid() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.pid = "1234".to_string();
        let mut row = make_row("line");
        row.pid = Some(1234);

        assert!(matches_structured_filters(&row, &request));

        row.pid = Some(4321);
        assert!(!matches_structured_filters(&row, &request));
    }

    fn make_row(raw: &str) -> DeviceLogQueryRow {
        DeviceLogQueryRow {
            seq: 1,
            received_at_ms: 1,
            raw: raw.to_string(),
            timestamp: None,
            level: "info".to_string(),
            pid: None,
            tid: None,
            process: String::new(),
            domain: String::new(),
            tag: String::new(),
            message: raw.to_string(),
        }
    }
}
