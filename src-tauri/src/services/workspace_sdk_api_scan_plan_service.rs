#![allow(dead_code)]

use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSdkApiScanPlan {
    pub sdk_path: String,
    pub files: Vec<String>,
}

pub fn plan_sdk_api_scan(sdk_path: &str) -> Result<WorkspaceSdkApiScanPlan, String> {
    let root = Path::new(sdk_path);
    if !root.is_dir() {
        return Ok(WorkspaceSdkApiScanPlan {
            sdk_path: sdk_path.to_string(),
            files: Vec::new(),
        });
    }

    let mut files = Vec::new();
    collect_api_files(root, &mut files)?;
    files.sort();
    Ok(WorkspaceSdkApiScanPlan {
        sdk_path: sdk_path.to_string(),
        files,
    })
}

pub fn sdk_api_scan_chunks(mut files: Vec<String>, chunk_size: usize) -> Vec<Vec<String>> {
    files.sort();
    files
        .chunks(chunk_size.max(1))
        .map(|chunk| chunk.to_vec())
        .collect()
}

fn collect_api_files(directory: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if should_skip_path(&path) {
            continue;
        }
        if path.is_dir() {
            collect_api_files(&path, files)?;
        } else if is_api_declaration_file(&path) {
            files.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

fn should_skip_path(path: &Path) -> bool {
    path_components(path).iter().any(|part| {
        matches!(
            part.as_str(),
            "build"
                | "dist"
                | "docs"
                | "node_modules"
                | "preview"
                | "sample"
                | "samples"
                | "test"
                | "tests"
        )
    })
}

fn is_api_declaration_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if file_name.ends_with(".d.ts") {
        return true;
    }
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(extension, "ets" | "ts")
        && path_components(path)
            .iter()
            .any(|part| matches!(part.as_str(), "api" | "ets" | "component"))
}

fn path_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect()
}
