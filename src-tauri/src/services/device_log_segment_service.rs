use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::Path;

const MAX_SEGMENT_READ_BYTES: u64 = 16 * 1024 * 1024;

pub struct SegmentWriteReceipt {
    pub offset: u64,
    pub bytes: u64,
    pub line_count: u64,
    pub segment_file: String,
}

pub struct DeviceLogSegmentWriter {
    file: File,
    offset: u64,
    segment_file: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceLogSegmentReadError {
    StaleSegment(String),
    Fatal(String),
}

impl fmt::Display for DeviceLogSegmentReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DeviceLogSegmentReadError::StaleSegment(message)
            | DeviceLogSegmentReadError::Fatal(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DeviceLogSegmentReadError {}

impl DeviceLogSegmentWriter {
    pub fn open(root: &Path, stream_id: &str) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let segment_file = segment_file_name(stream_id);
        let path = root.join(&segment_file);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        let offset = file
            .seek(SeekFrom::End(0))
            .map_err(|error| error.to_string())?;

        Ok(Self {
            file,
            offset,
            segment_file,
        })
    }

    pub fn append_lines(&mut self, lines: &[String]) -> Result<SegmentWriteReceipt, String> {
        let offset = self.offset;
        let mut bytes = 0_u64;

        for line in lines {
            self.file
                .write_all(line.as_bytes())
                .map_err(|error| error.to_string())?;
            self.file
                .write_all(b"\n")
                .map_err(|error| error.to_string())?;
            bytes = bytes.saturating_add(line.len() as u64 + 1);
        }
        self.file.flush().map_err(|error| error.to_string())?;
        self.offset = self.offset.saturating_add(bytes);

        Ok(SegmentWriteReceipt {
            offset,
            bytes,
            line_count: lines.len() as u64,
            segment_file: self.segment_file.clone(),
        })
    }
}

pub fn read_segment_file_lines(
    root: &Path,
    segment_file: &str,
    offset: u64,
    bytes: u64,
) -> Result<Vec<String>, DeviceLogSegmentReadError> {
    if bytes > MAX_SEGMENT_READ_BYTES {
        return Err(DeviceLogSegmentReadError::Fatal(
            "Device log segment read exceeds maximum batch bytes".to_string(),
        ));
    }
    let mut file = File::open(root.join(segment_file)).map_err(segment_open_error)?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| DeviceLogSegmentReadError::Fatal(error.to_string()))?;
    let mut buffer = vec![0_u8; bytes as usize];
    file.read_exact(&mut buffer).map_err(segment_read_error)?;
    let text = String::from_utf8(buffer)
        .map_err(|error| DeviceLogSegmentReadError::Fatal(error.to_string()))?;
    Ok(text.lines().map(str::to_string).collect())
}

pub fn segment_file_exists(root: &Path, segment_file: &str) -> bool {
    root.join(segment_file).is_file()
}

fn segment_file_name(stream_id: &str) -> String {
    format!("{stream_id}.logseg")
}

fn segment_open_error(error: std::io::Error) -> DeviceLogSegmentReadError {
    if error.kind() == ErrorKind::NotFound {
        return DeviceLogSegmentReadError::StaleSegment(error.to_string());
    }
    DeviceLogSegmentReadError::Fatal(error.to_string())
}

fn segment_read_error(error: std::io::Error) -> DeviceLogSegmentReadError {
    if error.kind() == ErrorKind::UnexpectedEof {
        return DeviceLogSegmentReadError::StaleSegment(error.to_string());
    }
    DeviceLogSegmentReadError::Fatal(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn appends_lines_and_reads_by_offset() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");

        let first = writer
            .append_lines(&["one".to_string(), "two".to_string()])
            .expect("first");
        let second = writer.append_lines(&["three".to_string()]).expect("second");

        assert_eq!(
            read_segment_file_lines(&temp, &first.segment_file, first.offset, first.bytes).unwrap(),
            vec!["one", "two"]
        );
        assert_eq!(
            read_segment_file_lines(&temp, &second.segment_file, second.offset, second.bytes)
                .unwrap(),
            vec!["three"]
        );
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn rejects_oversized_segment_reads_before_allocating() {
        let temp = unique_temp_dir();
        fs::create_dir_all(&temp).expect("tempdir");
        let mut writer = DeviceLogSegmentWriter::open(&temp, "stream-1").expect("writer");
        writer.append_lines(&["small".to_string()]).expect("append");

        let error = read_segment_file_lines(&temp, "stream-1.logseg", 0, 64 * 1024 * 1024)
            .expect_err("oversized read should fail");

        assert_eq!(
            error.to_string(),
            "Device log segment read exceeds maximum batch bytes"
        );
        fs::remove_dir_all(temp).expect("cleanup");
    }

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "arkline-device-log-segment-{}-{nanos}-{counter}",
            std::process::id(),
        ))
    }
}
