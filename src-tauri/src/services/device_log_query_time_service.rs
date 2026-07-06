const SQLITE_MAX_TIME_MS: u64 = i64::MAX as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceLogQueryTimeRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

pub fn normalize_query_time_range(now_ms: u64, time_range_ms: u64) -> DeviceLogQueryTimeRange {
    let end_ms = now_ms.min(SQLITE_MAX_TIME_MS);
    let start_ms = end_ms.saturating_sub(time_range_ms).min(end_ms);
    DeviceLogQueryTimeRange { start_ms, end_ms }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_recent_window_without_changing_safe_values() {
        let range = normalize_query_time_range(70_000, 60_000);

        assert_eq!(range.start_ms, 10_000);
        assert_eq!(range.end_ms, 70_000);
    }

    #[test]
    fn clamps_sqlite_unsafe_now_without_wrapping_negative() {
        let range = normalize_query_time_range(u64::MAX, 60_000);

        assert_eq!(range.end_ms, SQLITE_MAX_TIME_MS);
        assert_eq!(range.start_ms, SQLITE_MAX_TIME_MS - 60_000);
    }

    #[test]
    fn keeps_unbounded_query_range_inside_sqlite_time_domain() {
        let range = normalize_query_time_range(u64::MAX, u64::MAX);

        assert_eq!(range.start_ms, 0);
        assert_eq!(range.end_ms, SQLITE_MAX_TIME_MS);
    }
}
