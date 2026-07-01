use std::fs;
use std::path::Path;

use crate::models::workspace::{
    WorkspaceDirectoryEntry, WorkspaceDirectoryEntryKind, WorkspaceScanSummary, WorkspaceSnapshot,
};

const DEFAULT_EXCLUDES: [&str; 11] = [
    ".git",
    ".hvigor",
    ".idea",
    ".arkline",
    ".ohpm",
    "build",
    "coverage",
    "dist",
    "oh_modules",
    "out",
    "node_modules",
];
const MAX_WORKSPACE_FILES: usize = 20_000;

pub fn scan_workspace(root_path: &Path) -> Result<WorkspaceSnapshot, String> {
    scan_workspace_with_limit(root_path, MAX_WORKSPACE_FILES)
}

pub fn scan_workspace_for_open(root_path: &Path) -> Result<WorkspaceSnapshot, String> {
    validate_workspace_root(root_path)?;

    Ok(WorkspaceSnapshot {
        root_name: workspace_root_name(root_path),
        root_path: normalize_path(root_path),
        files: Vec::new(),
        scan_summary: WorkspaceScanSummary {
            scanned_files: 0,
            skipped_entries: 0,
            truncated: true,
            exclude_rules: default_exclude_rules(),
        },
    })
}

fn scan_workspace_with_limit(
    root_path: &Path,
    max_files: usize,
) -> Result<WorkspaceSnapshot, String> {
    validate_workspace_root(root_path)?;

    let mut files = Vec::new();
    let mut scan_summary = WorkspaceScanSummary {
        scanned_files: 0,
        skipped_entries: 0,
        truncated: false,
        exclude_rules: default_exclude_rules(),
    };
    collect_files(
        root_path,
        root_path,
        max_files,
        &mut files,
        &mut scan_summary,
    )
    .map_err(|error| error.to_string())?;
    files.sort();
    scan_summary.scanned_files = files.len();

    Ok(WorkspaceSnapshot {
        root_name: workspace_root_name(root_path),
        root_path: normalize_path(root_path),
        files,
        scan_summary,
    })
}

pub fn list_workspace_directory(
    root_path: &Path,
    directory_path: &Path,
) -> Result<Vec<WorkspaceDirectoryEntry>, String> {
    if !root_path.exists() {
        return Err(format!(
            "Workspace path does not exist: {}",
            root_path.display()
        ));
    }

    if !root_path.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {}",
            root_path.display()
        ));
    }

    if !directory_path.exists() {
        return Err(format!(
            "Directory path does not exist: {}",
            directory_path.display()
        ));
    }

    if !directory_path.is_dir() {
        return Err(format!(
            "Directory path is not a directory: {}",
            directory_path.display()
        ));
    }

    if !directory_path.starts_with(root_path) {
        return Err(format!(
            "Directory path is outside the workspace: {}",
            directory_path.display()
        ));
    }

    let mut entries = Vec::new();

    for entry in fs::read_dir(directory_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let is_directory = path.is_dir();
        let excluded = should_exclude(root_path, &path);
        let has_children =
            is_directory && !excluded && directory_has_visible_children(root_path, &path);

        entries.push(WorkspaceDirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: normalize_path(&path),
            kind: if is_directory {
                WorkspaceDirectoryEntryKind::Directory
            } else {
                WorkspaceDirectoryEntryKind::File
            },
            excluded,
            has_children,
        });
    }

    entries.sort_by(|left, right| {
        if left.kind != right.kind {
            return if left.kind == WorkspaceDirectoryEntryKind::Directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        left.name.cmp(&right.name)
    });

    Ok(entries)
}

fn collect_files(
    root_path: &Path,
    current: &Path,
    max_files: usize,
    files: &mut Vec<String>,
    scan_summary: &mut WorkspaceScanSummary,
) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        if files.len() >= max_files {
            scan_summary.truncated = true;
            break;
        }

        let entry = entry?;
        let path = entry.path();

        if should_exclude(root_path, &path) {
            scan_summary.skipped_entries += 1;
            continue;
        }

        if path.is_dir() {
            collect_files(root_path, &path, max_files, files, scan_summary)?;
        } else {
            files.push(normalize_path(&path));
        }
    }

    Ok(())
}

pub fn should_exclude(root_path: &Path, path: &Path) -> bool {
    path.strip_prefix(root_path)
        .ok()
        .map(|relative| {
            relative.components().any(|component| {
                DEFAULT_EXCLUDES.contains(&component.as_os_str().to_string_lossy().as_ref())
            })
        })
        .unwrap_or(false)
}

fn directory_has_visible_children(root_path: &Path, directory_path: &Path) -> bool {
    let Ok(children) = fs::read_dir(directory_path) else {
        return false;
    };

    for child in children.flatten() {
        if !should_exclude(root_path, &child.path()) {
            return true;
        }
    }

    false
}

fn validate_workspace_root(root_path: &Path) -> Result<(), String> {
    if !root_path.exists() {
        return Err(format!(
            "Workspace path does not exist: {}",
            root_path.display()
        ));
    }

    if !root_path.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {}",
            root_path.display()
        ));
    }

    Ok(())
}

fn workspace_root_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace")
        .to_string()
}

fn default_exclude_rules() -> Vec<String> {
    DEFAULT_EXCLUDES
        .iter()
        .map(|rule| (*rule).to_string())
        .collect()
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

    use crate::models::workspace::WorkspaceDirectoryEntryKind;

    use super::{
        list_workspace_directory, normalize_path, scan_workspace, scan_workspace_for_open,
    };

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
        fs::create_dir_all(root.join("oh_modules").join("pkg")).unwrap();
        fs::create_dir_all(root.join(".ohpm").join("pkg")).unwrap();
        fs::create_dir_all(root.join(".idea")).unwrap();
        fs::create_dir_all(root.join(".arkline").join("index")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::create_dir_all(root.join("out")).unwrap();
        fs::create_dir_all(root.join("coverage")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join(".hvigor")).unwrap();
        fs::write(root.join("src").join("main.ets"), "entry").unwrap();
        fs::write(root.join("AppScope.json5"), "{}").unwrap();
        fs::write(root.join("node_modules").join("react").join("index.js"), "").unwrap();
        fs::write(root.join("oh_modules").join("pkg").join("index.js"), "").unwrap();
        fs::write(root.join(".ohpm").join("pkg").join("index.js"), "").unwrap();
        fs::write(root.join(".idea").join("workspace.xml"), "").unwrap();
        fs::write(
            root.join(".arkline")
                .join("index")
                .join("workspace-catalog.json"),
            "",
        )
        .unwrap();
        fs::write(root.join("build").join("bundle.js"), "").unwrap();
        fs::write(root.join("dist").join("bundle.js"), "").unwrap();
        fs::write(root.join("out").join("generated.js"), "").unwrap();
        fs::write(root.join("coverage").join("report.json"), "").unwrap();
        fs::write(root.join(".git").join("config"), "").unwrap();

        let snapshot = scan_workspace(&root).unwrap();

        assert_eq!(
            snapshot.root_name,
            root.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(
            snapshot.files,
            vec![
                normalize_path(&root.join("AppScope.json5")),
                normalize_path(&root.join("src").join("main.ets"))
            ]
        );
        assert_eq!(snapshot.scan_summary.scanned_files, 2);
        assert_eq!(snapshot.scan_summary.skipped_entries, 11);
        assert!(!snapshot.scan_summary.truncated);
        assert!(snapshot
            .scan_summary
            .exclude_rules
            .contains(&"oh_modules".to_string()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_scan_returns_root_only_partial_snapshot_for_large_workspaces() {
        let root = unique_temp_dir("workspace-open-root-only");
        let source_dir = root.join("entry").join("src").join("main").join("ets");
        fs::create_dir_all(&source_dir).unwrap();
        for index in 0..1_050 {
            fs::write(
                source_dir.join(format!("Page{index:04}.ets")),
                "struct Page {}\n",
            )
            .unwrap();
        }

        let snapshot = scan_workspace_for_open(&root).unwrap();

        assert_eq!(snapshot.root_path, normalize_path(&root));
        assert!(snapshot.files.is_empty());
        assert_eq!(snapshot.scan_summary.scanned_files, 0);
        assert!(snapshot.scan_summary.truncated);
        assert!(snapshot
            .scan_summary
            .exclude_rules
            .contains(&"oh_modules".to_string()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scan_workspace_caps_large_file_sets() {
        let root = unique_temp_dir("workspace-scan-limit");
        fs::create_dir_all(root.join("src")).unwrap();

        for index in 0..25_100 {
            fs::write(root.join("src").join(format!("file-{index}.ets")), "").unwrap();
        }

        let snapshot = scan_workspace(&root).unwrap();

        assert_eq!(snapshot.files.len(), 20_000);
        assert_eq!(snapshot.scan_summary.scanned_files, 20_000);
        assert!(snapshot.scan_summary.truncated);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_one_directory_level_with_excluded_directories_marked() {
        let root = unique_temp_dir("workspace-directory-listing");
        fs::create_dir_all(root.join("src").join("pages")).unwrap();
        fs::create_dir_all(root.join("oh_modules").join("pkg")).unwrap();
        fs::write(root.join("AppScope.json5"), "{}").unwrap();
        fs::write(root.join("src").join("pages").join("Index.ets"), "entry").unwrap();
        fs::write(root.join("oh_modules").join("pkg").join("index.js"), "").unwrap();

        let entries = list_workspace_directory(&root, &root).unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "oh_modules");
        assert_eq!(entries[0].kind, WorkspaceDirectoryEntryKind::Directory);
        assert!(entries[0].excluded);
        assert!(!entries[0].has_children);
        assert_eq!(entries[1].name, "src");
        assert_eq!(entries[1].kind, WorkspaceDirectoryEntryKind::Directory);
        assert!(!entries[1].excluded);
        assert!(entries[1].has_children);
        assert_eq!(entries[2].name, "AppScope.json5");
        assert_eq!(entries[2].kind, WorkspaceDirectoryEntryKind::File);
        assert!(!entries[2].has_children);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_workspace_path() {
        let missing = unique_temp_dir("missing");
        let error = scan_workspace(&missing).unwrap_err();

        assert!(error.contains("does not exist"));
    }
}
