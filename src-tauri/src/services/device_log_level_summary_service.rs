#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DeviceLogSeverityCounts {
    pub warn: u64,
    pub error: u64,
    pub fatal: u64,
}

pub(crate) fn summarize_log_levels(lines: &[String]) -> Vec<String> {
    let mut levels = Vec::<String>::new();
    for line in lines {
        let level = level_from_line(line);
        if !levels.iter().any(|existing| existing == level) {
            levels.push(level.to_string());
        }
    }
    levels
}

pub(crate) fn count_log_severities(lines: &[String]) -> DeviceLogSeverityCounts {
    let mut counts = DeviceLogSeverityCounts::default();
    for line in lines {
        match level_from_line(line) {
            "warn" => counts.warn = counts.warn.saturating_add(1),
            "error" => counts.error = counts.error.saturating_add(1),
            "fatal" => counts.fatal = counts.fatal.saturating_add(1),
            _ => {}
        }
    }
    counts
}

fn level_from_line(line: &str) -> &'static str {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 5 {
        return "unknown";
    }
    match parts[4] {
        "V" => "verbose",
        "D" => "debug",
        "I" => "info",
        "W" => "warn",
        "E" => "error",
        "F" => "fatal",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_unique_levels_in_first_seen_order() {
        let lines = vec![
            "06-25 15:21:48.123  1234  5678 I C03F00/AppTag demo: one".to_string(),
            "06-25 15:21:49.123  1234  5678 E C03F00/AppTag demo: two".to_string(),
            "06-25 15:21:50.123  1234  5678 I C03F00/AppTag demo: three".to_string(),
        ];

        assert_eq!(summarize_log_levels(&lines), vec!["info", "error"]);
    }

    #[test]
    fn keeps_unknown_for_unparsed_lines() {
        let lines = vec!["plain boot message".to_string()];

        assert_eq!(summarize_log_levels(&lines), vec!["unknown"]);
    }

    #[test]
    fn counts_only_warning_error_and_fatal_lines() {
        let lines = vec![
            "06-25 15:21:48.123  1234  5678 I C03F00/AppTag demo: info".to_string(),
            "06-25 15:21:49.123  1234  5678 W C03F00/AppTag demo: warn".to_string(),
            "06-25 15:21:50.123  1234  5678 E C03F00/AppTag demo: error".to_string(),
            "06-25 15:21:51.123  1234  5678 F C03F00/AppTag demo: fatal".to_string(),
            "plain boot message".to_string(),
        ];

        assert_eq!(
            count_log_severities(&lines),
            DeviceLogSeverityCounts {
                warn: 1,
                error: 1,
                fatal: 1,
            }
        );
    }
}
