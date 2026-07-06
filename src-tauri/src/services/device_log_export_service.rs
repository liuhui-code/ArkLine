use std::fs::{self, File};
use std::io::{BufWriter, Error, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::device_log_query::{DeviceLogQueryRequest, DeviceLogQueryResponse};

const EXPORT_MAX_PAGES: usize = 10_000;
const TEXT_EXPORT_MAX_BYTES: usize = 8 * 1024 * 1024;
const TEXT_EXPORT_TOO_LARGE_ERROR: &str =
    "Device log text export exceeds maximum in-memory bytes; use file export";

pub fn export_query_pages_as_text<F>(
    request: DeviceLogQueryRequest,
    query_page: F,
) -> Result<String, String>
where
    F: FnMut(&DeviceLogQueryRequest) -> Result<DeviceLogQueryResponse, String>,
{
    let mut output = BoundedMemoryExport::new(TEXT_EXPORT_MAX_BYTES);
    export_query_pages_to_writer(request, &mut output, query_page)?;
    String::from_utf8(output.into_inner()).map_err(|error| error.to_string())
}

pub fn export_query_pages_to_file<F>(
    request: DeviceLogQueryRequest,
    path: &Path,
    query_page: F,
) -> Result<(), String>
where
    F: FnMut(&DeviceLogQueryRequest) -> Result<DeviceLogQueryResponse, String>,
{
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }

    let temp_path = temporary_export_path(path);
    let file = File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    if let Err(error) = export_query_pages_to_writer(request, &mut writer, query_page)
        .and_then(|()| writer.flush().map_err(|error| error.to_string()))
    {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    replace_export_target(&temp_path, path)
}

pub fn export_query_pages_to_writer<F, W>(
    mut request: DeviceLogQueryRequest,
    writer: &mut W,
    mut query_page: F,
) -> Result<(), String>
where
    F: FnMut(&DeviceLogQueryRequest) -> Result<DeviceLogQueryResponse, String>,
    W: Write,
{
    let mut previous_cursor = None;
    for _ in 0..EXPORT_MAX_PAGES {
        let response = query_page(&request)?;
        write_response_to_writer(&response, writer)?;

        let Some(next_cursor) = response.next_cursor_seq else {
            return Ok(());
        };
        if previous_cursor == Some(next_cursor) {
            return Err("Device log export cursor did not advance".to_string());
        }
        previous_cursor = Some(next_cursor);
        request.cursor_seq = Some(next_cursor);
    }

    Err("Device log export exceeded maximum page count".to_string())
}

fn write_response_to_writer<W: Write>(
    response: &DeviceLogQueryResponse,
    writer: &mut W,
) -> Result<(), String> {
    for row in &response.rows {
        writer
            .write_all(row.raw.as_bytes())
            .and_then(|()| writer.write_all(b"\n"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn replace_export_target(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    if target_path.exists() {
        fs::remove_file(target_path).map_err(|error| error.to_string())?;
    }
    fs::rename(temp_path, target_path).map_err(|error| error.to_string())
}

fn temporary_export_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "device-log-export".into());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    path.with_file_name(format!(".{file_name}.{}.{}.tmp", std::process::id(), nanos))
}

struct BoundedMemoryExport {
    bytes: Vec<u8>,
    max_bytes: usize,
}

impl BoundedMemoryExport {
    fn new(max_bytes: usize) -> Self {
        Self {
            bytes: Vec::new(),
            max_bytes,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for BoundedMemoryExport {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let next_len = self.bytes.len().saturating_add(buf.len());
        if next_len > self.max_bytes {
            return Err(Error::new(ErrorKind::Other, TEXT_EXPORT_TOO_LARGE_ERROR));
        }
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        export_query_pages_as_text, export_query_pages_to_file, export_query_pages_to_writer,
    };
    use crate::models::device_log_query::{
        DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryRow, DeviceLogQueryStopReason,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn exports_raw_query_rows_without_reformatting_or_truncating() {
        let response = DeviceLogQueryResponse {
            rows: vec![
                row(1, "06-25 raw width log"),
                row(2, "plain raw log with symbols []{}"),
            ],
            total_candidates: 2,
            scanned_lines: 2,
            truncated: false,
            next_cursor_seq: None,
            continuation_cursor_seq: None,
            continuation_reason: "none".to_string(),
            budget_exceeded: false,
            stop_reason: DeviceLogQueryStopReason::Complete,
            query_ms: 3,
        };

        assert_eq!(
            response_as_text(&response),
            "06-25 raw width log\nplain raw log with symbols []{}\n"
        );
    }

    #[test]
    fn exports_all_query_pages_until_cursor_is_exhausted() {
        let mut cursors = Vec::new();
        let mut request = DeviceLogQueryRequest::recent("stream-1");
        request.limit = 1;

        let exported = export_query_pages_as_text(request, |page_request| {
            cursors.push(page_request.cursor_seq);
            Ok(match page_request.cursor_seq {
                None => response(vec![row(3, "newest")], Some(3)),
                Some(3) => response(vec![row(2, "middle")], Some(2)),
                Some(2) => response(vec![row(1, "oldest")], None),
                _ => response(Vec::new(), None),
            })
        })
        .expect("export");

        assert_eq!(exported, "newest\nmiddle\noldest\n");
        assert_eq!(cursors, vec![None, Some(3), Some(2)]);
    }

    #[test]
    fn rejects_export_when_cursor_does_not_advance() {
        let request = DeviceLogQueryRequest::recent("stream-1");

        let error = export_query_pages_as_text(request, |_| Ok(response(Vec::new(), Some(3))))
            .expect_err("stalled cursor");

        assert_eq!(error, "Device log export cursor did not advance");
    }

    #[test]
    fn rejects_in_memory_text_export_when_output_is_too_large() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let large_raw = "x".repeat(8 * 1024 * 1024 + 1);

        let error =
            export_query_pages_as_text(request, |_| Ok(response(vec![row(1, &large_raw)], None)))
                .expect_err("large text export");

        assert_eq!(
            error,
            "Device log text export exceeds maximum in-memory bytes; use file export"
        );
    }

    #[test]
    fn writes_query_pages_to_a_streaming_writer() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let mut output = Vec::new();

        export_query_pages_to_writer(request, &mut output, |page_request| {
            Ok(match page_request.cursor_seq {
                None => response(vec![row(2, "second")], Some(2)),
                Some(2) => response(vec![row(1, "first")], None),
                _ => response(Vec::new(), None),
            })
        })
        .expect("export");

        assert_eq!(String::from_utf8(output).expect("utf8"), "second\nfirst\n");
    }

    #[test]
    fn writes_query_pages_to_a_file_path() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let path = temp_export_path();

        export_query_pages_to_file(request, &path, |page_request| {
            Ok(match page_request.cursor_seq {
                None => response(vec![row(2, "visible row")], Some(2)),
                Some(2) => response(vec![row(1, "older row")], None),
                _ => response(Vec::new(), None),
            })
        })
        .expect("export");

        assert_eq!(
            fs::read_to_string(&path).expect("exported file"),
            "visible row\nolder row\n"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn file_export_preserves_existing_target_when_page_query_fails() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let path = temp_export_path();
        fs::write(&path, "existing\n").expect("seed target");

        let error = export_query_pages_to_file(request, &path, |page_request| {
            if page_request.cursor_seq.is_none() {
                return Ok(response(vec![row(2, "partial")], Some(2)));
            }
            Err("backend failed".to_string())
        })
        .expect_err("export failure");

        assert_eq!(error, "backend failed");
        assert_eq!(fs::read_to_string(&path).expect("target"), "existing\n");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn file_export_streams_large_rows_without_memory_text_cap() {
        let request = DeviceLogQueryRequest::recent("stream-1");
        let path = temp_export_path();
        let large_raw = "x".repeat(8 * 1024 * 1024 + 1);

        export_query_pages_to_file(request, &path, |_| {
            Ok(response(vec![row(1, &large_raw)], None))
        })
        .expect("file export");

        assert_eq!(
            fs::metadata(&path).expect("metadata").len(),
            large_raw.len() as u64 + 1
        );
        let _ = fs::remove_file(path);
    }

    fn row(seq: u64, raw: &str) -> DeviceLogQueryRow {
        DeviceLogQueryRow {
            seq,
            received_at_ms: 70_000,
            raw: raw.to_string(),
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

    fn response_as_text(response: &DeviceLogQueryResponse) -> String {
        let mut output = Vec::new();
        export_query_pages_to_writer(
            DeviceLogQueryRequest::recent("stream-1"),
            &mut output,
            |_| Ok(response.clone()),
        )
        .expect("write");
        String::from_utf8(output).expect("utf8")
    }

    fn response(
        rows: Vec<DeviceLogQueryRow>,
        next_cursor_seq: Option<u64>,
    ) -> DeviceLogQueryResponse {
        DeviceLogQueryResponse {
            rows,
            total_candidates: 0,
            scanned_lines: 0,
            truncated: next_cursor_seq.is_some(),
            next_cursor_seq,
            continuation_cursor_seq: next_cursor_seq,
            continuation_reason: if next_cursor_seq.is_some() {
                "limit"
            } else {
                "none"
            }
            .to_string(),
            budget_exceeded: false,
            stop_reason: DeviceLogQueryStopReason::Complete,
            query_ms: 0,
        }
    }

    fn temp_export_path() -> PathBuf {
        let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("arkline-device-log-export-{id}.log"))
    }
}
