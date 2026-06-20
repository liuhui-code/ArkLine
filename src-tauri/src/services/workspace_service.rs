use std::fs;
use std::path::Path;

use crate::models::workspace::WorkspaceSnapshot;

const DEFAULT_EXCLUDES: [&str; 4] = [".git", ".hvigor", "build", "node_modules"];

pub fn scan_workspace(root_path: &Path) -> Result<WorkspaceSnapshot, String> {
    if !root_path.exists() {
        return Err(format!("Workspace path does not exist: {}", root_path.display()));
    }

    if !root_path.is_dir() {
        return Err(format!("Workspace path is not a directory: {}", root_path.display()));
    }

    let mut files = Vec::new();
    collect_files(root_path, root_path, &mut files).map_err(|error| error.to_string())?;
    files.sort();

    Ok(WorkspaceSnapshot {
        root_name: root_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace")
            .to_string(),
        root_path: normalize_path(root_path),
        files,
    })
}

fn collect_files(root_path: &Path, current: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();

        if should_exclude(root_path, &path) {
            continue;
        }

        if path.is_dir() {
            collect_files(root_path, &path, files)?;
        } else {
            files.push(normalize_path(&path));
        }
    }

    Ok(())
}

fn should_exclude(root_path: &Path, path: &Path) -> bool {
    path.strip_prefix(root_path)
        .ok()
        .map(|relative| {
            relative
                .components()
                .any(|component| DEFAULT_EXCLUDES.contains(&component.as_os_str().to_string_lossy().as_ref()))
        })
        .unwrap_or(false)
}

pub fn normalize_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();

    if cfg!(windows) {
        value.replace('/', "\\")
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{normalize_path, scan_workspace};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn scans_workspace_and_ignores_default_excludes() {
        let root = unique_temp_dir("workspace-scan");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules").join("react")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join(".hvigor")).unwrap();
        fs::write(root.join("src").join("main.ets"), "entry").unwrap();
        fs::write(root.join("AppScope.json5"), "{}").unwrap();
        fs::write(root.join("node_modules").join("react").join("index.js"), "").unwrap();
        fs::write(root.join("build").join("bundle.js"), "").unwrap();
        fs::write(root.join(".git").join("config"), "").unwrap();

        let snapshot = scan_workspace(&root).unwrap();

        assert_eq!(snapshot.root_name, root.file_name().unwrap().to_string_lossy());
        assert_eq!(
            snapshot.files,
            vec![
                normalize_path(&root.join("AppScope.json5")),
                normalize_path(&root.join("src").join("main.ets"))
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_workspace_path() {
        let missing = unique_temp_dir("missing");
        let error = scan_workspace(&missing).unwrap_err();

        assert!(error.contains("does not exist"));
    }
}
