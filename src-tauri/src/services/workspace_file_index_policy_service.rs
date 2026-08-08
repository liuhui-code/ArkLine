use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

pub(crate) const WORKSPACE_FULL_CONTENT_MAX_BYTES: usize = 4 * 1024 * 1024;
const BINARY_PROBE_BYTES: u64 = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceFileIndexClass {
    Normal,
    LargeText,
    Generated,
    Binary,
}

impl WorkspaceFileIndexClass {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::LargeText => "large-text",
            Self::Generated => "generated",
            Self::Binary => "binary",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceFileLayerPolicy {
    Index,
    Skip,
}

impl WorkspaceFileLayerPolicy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Index => "index",
            Self::Skip => "skip",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceFileIndexPolicy {
    pub(crate) class: WorkspaceFileIndexClass,
    pub(crate) content: WorkspaceFileLayerPolicy,
    pub(crate) symbols: WorkspaceFileLayerPolicy,
    pub(crate) reason: String,
}

impl WorkspaceFileIndexPolicy {
    fn normal() -> Self {
        Self {
            class: WorkspaceFileIndexClass::Normal,
            content: WorkspaceFileLayerPolicy::Index,
            symbols: WorkspaceFileLayerPolicy::Index,
            reason: "Eligible for full content and symbol indexing".to_string(),
        }
    }

    fn skipped(class: WorkspaceFileIndexClass, reason: String) -> Self {
        Self {
            class,
            content: WorkspaceFileLayerPolicy::Skip,
            symbols: WorkspaceFileLayerPolicy::Skip,
            reason,
        }
    }
}

pub(crate) fn classify_workspace_file(
    root_path: &Path,
    path: &Path,
    max_content_bytes: usize,
) -> Result<WorkspaceFileIndexPolicy, String> {
    let file_path = filesystem_path(path);
    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    let probe = read_probe(&file_path)?;
    if is_binary_extension(&file_path) || probe.contains(&0) || std::str::from_utf8(&probe).is_err()
    {
        return Ok(WorkspaceFileIndexPolicy::skipped(
            WorkspaceFileIndexClass::Binary,
            "Binary or non-UTF-8 files are catalogued but not content indexed".to_string(),
        ));
    }
    if is_generated_path(root_path, &file_path) {
        return Ok(WorkspaceFileIndexPolicy::skipped(
            WorkspaceFileIndexClass::Generated,
            "Generated files are catalogued but excluded from background content and symbol indexing"
                .to_string(),
        ));
    }
    if metadata.len() > max_content_bytes as u64 {
        return Ok(WorkspaceFileIndexPolicy::skipped(
            WorkspaceFileIndexClass::LargeText,
            format!("Text file exceeds the {max_content_bytes} byte full-index threshold"),
        ));
    }
    Ok(WorkspaceFileIndexPolicy::normal())
}

pub(crate) fn ensure_workspace_file_index_policy_columns(
    connection: &Connection,
) -> Result<(), String> {
    for (column, declaration) in [
        ("index_class", "text not null default 'normal'"),
        ("content_policy", "text not null default 'index'"),
        ("symbol_policy", "text not null default 'index'"),
        ("policy_reason", "text"),
    ] {
        let mut statement = connection
            .prepare("pragma table_info(workspace_file_fingerprints)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        if !columns.iter().any(|existing| existing == column) {
            connection
                .execute(
                    &format!(
                        "alter table workspace_file_fingerprints add column {column} {declaration}"
                    ),
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn read_probe(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(BINARY_PROBE_BYTES as usize);
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(BINARY_PROBE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn is_generated_path(root_path: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root_path).unwrap_or(path);
    let portable = relative.to_string_lossy().replace('\\', "/").to_lowercase();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
    portable
        .split('/')
        .any(|part| part == "generated" || part == ".generated")
        || file_name.contains(".generated.")
        || file_name.ends_with(".g.ets")
        || file_name.ends_with(".g.ts")
}

fn is_binary_extension(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        extension.as_str(),
        "7z" | "a"
            | "apk"
            | "bin"
            | "bmp"
            | "class"
            | "dll"
            | "dylib"
            | "exe"
            | "gif"
            | "gz"
            | "ico"
            | "jar"
            | "jpeg"
            | "jpg"
            | "mp3"
            | "mp4"
            | "o"
            | "pdf"
            | "png"
            | "so"
            | "tar"
            | "webp"
            | "woff"
            | "woff2"
            | "zip"
    )
}

fn filesystem_path(path: &Path) -> PathBuf {
    if path.exists() {
        return path.to_path_buf();
    }
    PathBuf::from(path.to_string_lossy().replace('\\', "/"))
}
