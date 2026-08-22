use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn read_text_file(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Err(format!("Document path does not exist: {}", path.display()));
    }

    if path.is_dir() {
        return Err(format!("Document path is a directory: {}", path.display()));
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

pub fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    write_file_bytes(path, content.as_bytes())
}

pub fn write_file_bytes(path: &Path, content: &[u8]) -> Result<(), String> {
    write_file_atomically(path, content)
}

pub fn write_text_file_if_unchanged(
    path: &Path,
    content: &str,
    expected_content: &str,
) -> Result<(), String> {
    let actual_content = if path.exists() {
        read_text_file(path)?
    } else {
        String::new()
    };
    if actual_content != expected_content {
        return Err(format!("Document changed on disk: {}", path.display()));
    }

    write_file_bytes(path, content.as_bytes())
}

fn write_file_atomically(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temporary_path = temporary_document_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| error.to_string())?;
        file.write_all(content).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        if let Ok(metadata) = fs::metadata(path) {
            fs::set_permissions(&temporary_path, metadata.permissions())
                .map_err(|error| error.to_string())?;
        }
        replace_document_file(path, &temporary_path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn temporary_document_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    path.with_file_name(format!(".{file_name}.arkline-{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(not(windows))]
fn replace_document_file(path: &Path, temporary_path: &Path) -> Result<(), String> {
    fs::rename(temporary_path, path).map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn replace_document_file(path: &Path, temporary_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    if !path.exists() {
        return fs::rename(temporary_path, path).map_err(|error| error.to_string());
    }
    let replaced = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    (result != 0)
        .then_some(())
        .ok_or_else(|| std::io::Error::last_os_error().to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::read_text_file;
    use super::write_text_file;
    use super::write_text_file_if_unchanged;

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}.txt"))
    }

    #[test]
    fn reads_existing_text_file() {
        let path = unique_temp_path("read-text");
        fs::write(&path, "hello arkline").unwrap();

        let content = read_text_file(&path).unwrap();
        assert_eq!(content, "hello arkline");

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_missing_text_file() {
        let path = unique_temp_path("missing");
        let error = read_text_file(&path).unwrap_err();

        assert!(error.contains("does not exist"));
    }

    #[test]
    fn writes_text_file() {
        let path = unique_temp_path("write-text");
        write_text_file(&path, "saved from arkline").unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "saved from arkline");

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_save_when_disk_content_changed_since_open() {
        let path = unique_temp_path("write-conflict");
        fs::write(&path, "opened content").unwrap();
        fs::write(&path, "external content").unwrap();

        let error =
            write_text_file_if_unchanged(&path, "local content", "opened content").unwrap_err();

        assert!(error.contains("changed on disk"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external content");

        fs::remove_file(path).unwrap();
    }
}
