use std::fs;
use std::path::Path;

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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(path, content).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::read_text_file;
    use super::write_text_file;

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
}
