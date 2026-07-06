use crate::models::device_log_query::DeviceLogQueryRequest;
use crate::services::device_log_metadata_service::DeviceLogMetadataRow;

pub(crate) fn batch_excluded_by_metadata(
    batch: &DeviceLogMetadataRow,
    request: &DeviceLogQueryRequest,
) -> bool {
    batch_excluded_by_cursor(batch, request) || batch_excluded_by_level(batch, request)
}

fn batch_excluded_by_cursor(batch: &DeviceLogMetadataRow, request: &DeviceLogQueryRequest) -> bool {
    request
        .cursor_seq
        .is_some_and(|cursor_seq| batch.first_seq >= cursor_seq)
}

fn batch_excluded_by_level(batch: &DeviceLogMetadataRow, request: &DeviceLogQueryRequest) -> bool {
    !request.levels.is_empty()
        && !batch.levels.is_empty()
        && !request
            .levels
            .iter()
            .any(|level| batch.levels.iter().any(|batch_level| batch_level == level))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_batches_when_request_has_no_level_filter() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let batch = make_batch(vec!["info"]);

        assert!(!batch_excluded_by_metadata(&batch, &request));
    }

    #[test]
    fn keeps_legacy_batches_without_level_summary() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.levels = vec!["error".to_string()];
        let batch = make_batch(vec![]);

        assert!(!batch_excluded_by_metadata(&batch, &request));
    }

    #[test]
    fn excludes_batches_when_level_summary_cannot_match() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.levels = vec!["error".to_string()];
        let batch = make_batch(vec!["info", "debug"]);

        assert!(batch_excluded_by_metadata(&batch, &request));
    }

    #[test]
    fn keeps_batches_when_any_level_matches() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.levels = vec!["error".to_string(), "fatal".to_string()];
        let batch = make_batch(vec!["info", "error"]);

        assert!(!batch_excluded_by_metadata(&batch, &request));
    }

    #[test]
    fn excludes_batches_fully_newer_than_cursor() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.cursor_seq = Some(10);
        let batch = DeviceLogMetadataRow {
            first_seq: 10,
            line_count: 3,
            ..make_batch(vec!["info"])
        };

        assert!(batch_excluded_by_metadata(&batch, &request));
    }

    #[test]
    fn keeps_batches_that_may_contain_older_cursor_rows() {
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.cursor_seq = Some(10);
        let batch = DeviceLogMetadataRow {
            first_seq: 8,
            line_count: 3,
            ..make_batch(vec!["info"])
        };

        assert!(!batch_excluded_by_metadata(&batch, &request));
    }

    fn make_batch(levels: Vec<&str>) -> DeviceLogMetadataRow {
        DeviceLogMetadataRow {
            stream_id: "stream-1".to_string(),
            device_id: "device-1".to_string(),
            first_seq: 1,
            received_at_ms: 1,
            line_count: 1,
            segment_file: "stream-1.logseg".to_string(),
            segment_offset: 0,
            segment_bytes: 0,
            levels: levels.into_iter().map(str::to_string).collect(),
        }
    }
}
