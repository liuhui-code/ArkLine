use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::models::workspace_edit::EditConflict;
use crate::services::workspace_edit_path_service::conflict;
use crate::services::workspace_edit_service::ValidatedOperation;

pub(crate) fn validate_operation_relationships(
    operations: &[ValidatedOperation],
) -> Vec<EditConflict> {
    let mut conflicts = Vec::new();
    let mut text_paths = BTreeSet::new();
    let mut file_paths: BTreeMap<PathBuf, Vec<&'static str>> = BTreeMap::new();

    for operation in operations {
        match operation {
            ValidatedOperation::Text(edit) => {
                text_paths.insert(edit.path.clone());
            }
            ValidatedOperation::CreateFile { path, .. } => {
                file_paths.entry(path.clone()).or_default().push("create");
            }
            ValidatedOperation::CreateDirectory { path } => {
                file_paths
                    .entry(path.clone())
                    .or_default()
                    .push("create directory");
            }
            ValidatedOperation::RenameFile {
                old_path, new_path, ..
            }
            | ValidatedOperation::RenameDirectory {
                old_path, new_path, ..
            } => {
                file_paths
                    .entry(old_path.clone())
                    .or_default()
                    .push("rename source");
                file_paths
                    .entry(new_path.clone())
                    .or_default()
                    .push("rename target");
            }
            ValidatedOperation::DeleteFile { path, .. } => {
                file_paths.entry(path.clone()).or_default().push("delete");
            }
            ValidatedOperation::DeleteDirectory { path, .. } => {
                file_paths
                    .entry(path.clone())
                    .or_default()
                    .push("delete directory");
            }
        }
    }

    for path in &text_paths {
        if file_paths.contains_key(path) {
            conflicts.push(conflict(
                path,
                "Text edits cannot be mixed with file operations on the same path",
            ));
        }
        for file_path in file_paths.keys() {
            if path_is_ancestor(file_path, path) || path_is_ancestor(path, file_path) {
                conflicts.push(conflict(
                    path,
                    "Text edits cannot be mixed with file operations on parent or child paths",
                ));
            }
        }
    }

    for (path, roles) in file_paths {
        if roles.len() > 1 {
            conflicts.push(conflict(
                &path,
                format!(
                    "Multiple file operations affect the same path: {}",
                    roles.join(", ")
                ),
            ));
        }
    }

    conflicts
}

fn path_is_ancestor(parent: &Path, child: &Path) -> bool {
    parent != child && child.starts_with(parent)
}
