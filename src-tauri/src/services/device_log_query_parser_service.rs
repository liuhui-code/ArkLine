use crate::models::device_log_query::DeviceLogQueryRow;

pub(crate) fn parse_query_row(seq: u64, received_at_ms: u64, raw: &str) -> DeviceLogQueryRow {
    let parsed = parse_hilog_line(raw);
    DeviceLogQueryRow {
        seq,
        received_at_ms,
        raw: raw.to_string(),
        timestamp: parsed.timestamp,
        level: parsed.level,
        pid: parsed.pid,
        tid: parsed.tid,
        process: parsed.process,
        domain: parsed.domain,
        tag: parsed.tag,
        message: parsed.message,
    }
}

struct ParsedHiLogLine {
    timestamp: Option<String>,
    level: String,
    pid: Option<u64>,
    tid: Option<u64>,
    process: String,
    domain: String,
    tag: String,
    message: String,
}

fn parse_hilog_line(raw: &str) -> ParsedHiLogLine {
    let parts = raw.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 7 {
        return fallback_line(raw);
    }
    let level = match parts[4] {
        "V" => "verbose",
        "D" => "debug",
        "I" => "info",
        "W" => "warn",
        "E" => "error",
        "F" => "fatal",
        _ => "unknown",
    }
    .to_string();
    let Some((domain, tag)) = parts[5].split_once('/') else {
        return fallback_line(raw);
    };
    let process = parts[6].trim_end_matches(':').to_string();
    let message = raw
        .split_once(&format!("{}:", parts[6].trim_end_matches(':')))
        .map(|(_, message)| message.trim_start().to_string())
        .unwrap_or_else(|| raw.to_string());

    ParsedHiLogLine {
        timestamp: Some(format!("{} {}", parts[0], parts[1])),
        level,
        pid: parts[2].parse().ok(),
        tid: parts[3].parse().ok(),
        process,
        domain: domain.to_string(),
        tag: tag.to_string(),
        message,
    }
}

fn fallback_line(raw: &str) -> ParsedHiLogLine {
    ParsedHiLogLine {
        timestamp: None,
        level: "unknown".to_string(),
        pid: None,
        tid: None,
        process: String::new(),
        domain: String::new(),
        tag: String::new(),
        message: raw.to_string(),
    }
}
