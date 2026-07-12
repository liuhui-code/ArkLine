use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::models::workspace_edit::{EditConflict, TextRange};

const READONLY_COMPONENTS: [&str; 4] = [".git", ".hvigor", "build", "node_modules"];

pub(crate) fn normalize_workspace_root(workspace_root: &Path) -> Result<PathBuf, String> {
    if !workspace_root.exists() {
        return Err(format!(
            "Workspace root does not exist: {}",
            workspace_root.display()
        ));
    }
    if !workspace_root.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            workspace_root.display()
        ));
    }

    fs::canonicalize(workspace_root).map_err(|error| error.to_string())
}

pub(crate) fn validate_workspace_path(
    workspace_root: &Path,
    path: &str,
) -> Result<PathBuf, EditConflict> {
    let candidate = workspace_relative_path(workspace_root, path);
    let normalized = normalize_existing_or_parent(&candidate).map_err(|message| EditConflict {
        path: path.to_string(),
        message,
    })?;

    if !normalized.starts_with(workspace_root) {
        return Err(EditConflict {
            path: normalize_path(&normalized),
            message: format!(
                "Path is outside workspace root: {}",
                normalize_path(&normalized)
            ),
        });
    }

    if let Some(component) = readonly_component(workspace_root, &normalized) {
        return Err(EditConflict {
            path: normalize_path(&normalized),
            message: format!("Path is in readonly workspace directory: {component}"),
        });
    }

    Ok(normalized)
}

pub(crate) fn validate_parent(path: &Path) -> Result<(), EditConflict> {
    if let Some(parent) = path.parent() {
        if parent.exists() && !parent.is_dir() {
            return Err(conflict(path, "Parent path is not a directory"));
        }
    }
    Ok(())
}

pub(crate) fn text_range_to_byte_offsets(
    content: &str,
    range: &TextRange,
) -> Result<(usize, usize), String> {
    if range.start_line == 0
        || range.start_column == 0
        || range.end_line == 0
        || range.end_column == 0
    {
        return Err("Text range uses 1-based line and column values".to_string());
    }

    let start = line_column_to_byte_offset(content, range.start_line, range.start_column)?;
    let end = line_column_to_byte_offset(content, range.end_line, range.end_column)?;

    if start > end {
        return Err("Text range start is after end".to_string());
    }

    Ok((start, end))
}

pub(crate) fn conflict(path: &Path, message: impl Into<String>) -> EditConflict {
    EditConflict {
        path: normalize_path(path),
        message: message.into(),
    }
}

pub(crate) fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn workspace_relative_path(workspace_root: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        lexical_normalize(path)
    } else {
        lexical_normalize(&workspace_root.join(path))
    }
}

fn normalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|error| error.to_string());
    }

    let mut missing_components = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(file_name) = current.file_name() else {
            break;
        };
        missing_components.push(file_name.to_os_string());
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent;
    }

    if !current.exists() {
        return Ok(lexical_normalize(path));
    }

    let mut normalized = fs::canonicalize(current).map_err(|error| error.to_string())?;
    for component in missing_components.iter().rev() {
        normalized.push(component);
    }

    Ok(lexical_normalize(&normalized))
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(value) => normalized.push(value),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn readonly_component(workspace_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(workspace_root).ok().and_then(|relative| {
        relative.components().find_map(|component| {
            let value = component.as_os_str().to_string_lossy();
            READONLY_COMPONENTS
                .contains(&value.as_ref())
                .then(|| value.to_string())
        })
    })
}

fn line_column_to_byte_offset(content: &str, line: u32, column: u32) -> Result<usize, String> {
    let line_index = usize::try_from(line - 1).map_err(|_| "Line value is too large")?;
    let column_units = usize::try_from(column - 1).map_err(|_| "Column value is too large")?;
    let mut line_starts = vec![0usize];

    for (index, character) in content.char_indices() {
        if character == '\n' {
            line_starts.push(index + character.len_utf8());
        }
    }

    let Some(line_start) = line_starts.get(line_index).copied() else {
        return Err(format!("Line {line} is outside the file"));
    };
    let line_end = content[line_start..]
        .find('\n')
        .map(|offset| line_start + offset)
        .unwrap_or(content.len());
    let line_text = &content[line_start..line_end];
    let line_utf16_units = line_text.encode_utf16().count();

    if column_units > line_utf16_units {
        return Err(format!("Column {column} is outside line {line}"));
    }
    if column_units == line_utf16_units {
        return Ok(line_end);
    }

    let mut current_units = 0usize;
    for (offset, character) in line_text.char_indices() {
        if current_units == column_units {
            return Ok(line_start + offset);
        }
        let next_units = current_units + character.len_utf16();
        if column_units < next_units {
            return Err(format!(
                "Column {column} is not on a UTF-16 character boundary"
            ));
        }
        current_units = next_units;
    }

    Err(format!("Column {column} is outside line {line}"))
}
