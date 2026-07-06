use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogRuntimeStats {
    pub stream_id: String,
    pub device_id: String,
    pub stream_status: String,
    pub ingested_lines: u64,
    pub persisted_lines: u64,
    pub dropped_lines: u64,
    pub pending_batches: usize,
    pub buffer_bytes: u64,
    pub last_write_ms: u64,
    pub slow_write_batches: u64,
    pub warn_lines: u64,
    pub error_lines: u64,
    pub fatal_lines: u64,
    pub backpressure_state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogStorageHealth {
    pub root_path: String,
    pub total_bytes: u64,
    pub segment_file_count: usize,
    pub segment_bytes: u64,
    pub metadata_bytes: u64,
    pub metadata_batch_count: u64,
    pub metadata_line_count: u64,
    pub oldest_received_at_ms: Option<u64>,
    pub newest_received_at_ms: Option<u64>,
    pub pressure_state: String,
    pub recommended_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogStorageClearResult {
    pub removed_file_count: usize,
    pub removed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogRetentionCandidate {
    pub file_name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogRetentionPlan {
    pub current_bytes: u64,
    pub target_bytes: u64,
    pub remove_file_count: usize,
    pub remove_bytes: u64,
    pub candidates: Vec<DeviceLogRetentionCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogRetentionApplyResult {
    pub removed_file_count: usize,
    pub removed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogQueryRequest {
    pub stream_id: String,
    pub query: String,
    pub regex: bool,
    pub match_case: bool,
    pub levels: Vec<String>,
    pub pid: String,
    pub process: String,
    pub domain: String,
    pub tag: String,
    pub time_range_ms: u64,
    pub limit: usize,
    pub cursor_seq: Option<u64>,
    pub scan_budget_lines: Option<usize>,
}

#[cfg(test)]
impl DeviceLogQueryRequest {
    pub fn recent(stream_id: &str) -> Self {
        Self {
            stream_id: stream_id.to_string(),
            query: String::new(),
            regex: false,
            match_case: false,
            levels: Vec::new(),
            pid: String::new(),
            process: String::new(),
            domain: String::new(),
            tag: String::new(),
            time_range_ms: 60_000,
            limit: 500,
            cursor_seq: None,
            scan_budget_lines: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogQueryRow {
    pub seq: u64,
    pub received_at_ms: u64,
    pub raw: String,
    pub timestamp: Option<String>,
    pub level: String,
    pub pid: Option<u64>,
    pub tid: Option<u64>,
    pub process: String,
    pub domain: String,
    pub tag: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogQueryResponse {
    pub rows: Vec<DeviceLogQueryRow>,
    pub total_candidates: usize,
    pub scanned_lines: usize,
    pub truncated: bool,
    pub next_cursor_seq: Option<u64>,
    pub continuation_cursor_seq: Option<u64>,
    pub continuation_reason: String,
    pub budget_exceeded: bool,
    pub stop_reason: DeviceLogQueryStopReason,
    pub query_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogQueryWorkerStats {
    pub running: bool,
    pub queued: usize,
    pub completed_queries: u64,
    pub cancelled_queries: u64,
    pub failed_queries: u64,
    pub last_query_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogQueryWorkerEvent {
    pub sequence: u64,
    pub stream_id: String,
    pub query: String,
    pub status: String,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceLogQueryStopReason {
    Complete,
    Limit,
    ScanBudget,
    Deadline,
    Cancelled,
}

impl Default for DeviceLogRuntimeStats {
    fn default() -> Self {
        Self {
            stream_id: String::new(),
            device_id: String::new(),
            stream_status: "idle".to_string(),
            ingested_lines: 0,
            persisted_lines: 0,
            dropped_lines: 0,
            pending_batches: 0,
            buffer_bytes: 0,
            last_write_ms: 0,
            slow_write_batches: 0,
            warn_lines: 0,
            error_lines: 0,
            fatal_lines: 0,
            backpressure_state: "idle".to_string(),
            last_error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_stats_report_zero_loss_and_idle_pressure() {
        let stats = DeviceLogRuntimeStats::default();

        assert_eq!(stats.ingested_lines, 0);
        assert_eq!(stats.dropped_lines, 0);
        assert_eq!(stats.backpressure_state, "idle");
        assert_eq!(stats.stream_status, "idle");
    }

    #[test]
    fn query_request_defaults_to_recent_one_minute() {
        let request = DeviceLogQueryRequest::recent("stream-1");

        assert_eq!(request.stream_id, "stream-1");
        assert_eq!(request.time_range_ms, 60_000);
        assert_eq!(request.limit, 500);
    }
}
