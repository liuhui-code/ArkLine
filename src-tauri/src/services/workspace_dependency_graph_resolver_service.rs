use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_relative_import(
    from_path: &str,
    source_module: &str,
    file_set: &HashSet<String>,
) -> Option<String> {
    let from = PathBuf::from(from_path.replace('\\', "/"));
    let base = from.parent()?;
    let joined = normalize_path(&base.join(source_module));
    candidate_paths(&joined)
        .into_iter()
        .map(|path| normalize_index_path(&path))
        .find(|path| file_set.contains(path))
}

pub(crate) fn is_relative_module(source_module: &str) -> bool {
    source_module.starts_with("./") || source_module.starts_with("../")
}

fn candidate_paths(path: &Path) -> Vec<String> {
    let value = path.to_string_lossy();
    if has_source_extension(&value) {
        return vec![value.to_string()];
    }
    ["ets", "ts", "d.ts"]
        .iter()
        .map(|extension| format!("{value}.{extension}"))
        .chain(["ets", "ts"].iter().map(|extension| {
            path.join(format!("index.{extension}"))
                .to_string_lossy()
                .to_string()
        }))
        .collect()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn has_source_extension(value: &str) -> bool {
    value.ends_with(".ets") || value.ends_with(".ts") || value.ends_with(".d.ts")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
