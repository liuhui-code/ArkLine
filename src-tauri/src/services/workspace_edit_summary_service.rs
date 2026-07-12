use std::collections::BTreeSet;

use crate::models::workspace_edit::{WorkspaceEditOperation, WorkspaceEditPlan};

pub(crate) fn collect_affected_files(plan: &WorkspaceEditPlan) -> Vec<String> {
    if !plan.affected_files.is_empty() {
        return plan.affected_files.clone();
    }

    let mut files = BTreeSet::new();
    for operation in &plan.operations {
        match operation {
            WorkspaceEditOperation::Text { path, .. }
            | WorkspaceEditOperation::CreateFile { path, .. }
            | WorkspaceEditOperation::CreateDirectory { path }
            | WorkspaceEditOperation::DeleteFile { path, .. }
            | WorkspaceEditOperation::DeleteDirectory { path, .. } => {
                files.insert(path.clone());
            }
            WorkspaceEditOperation::RenameFile {
                old_path, new_path, ..
            }
            | WorkspaceEditOperation::RenameDirectory {
                old_path, new_path, ..
            } => {
                files.insert(old_path.clone());
                files.insert(new_path.clone());
            }
        }
    }

    files.into_iter().collect()
}

pub(crate) fn summarize_operation(operation: &WorkspaceEditOperation) -> String {
    match operation {
        WorkspaceEditOperation::Text { path, range, .. } => format!(
            "Edit {path} at {}:{}-{}:{}",
            range.start_line, range.start_column, range.end_line, range.end_column
        ),
        WorkspaceEditOperation::CreateFile {
            path, overwrite, ..
        } => {
            if *overwrite {
                format!("Create or overwrite {path}")
            } else {
                format!("Create {path}")
            }
        }
        WorkspaceEditOperation::CreateDirectory { path } => {
            format!("Create directory {path}")
        }
        WorkspaceEditOperation::RenameFile {
            old_path,
            new_path,
            overwrite,
        } => {
            if *overwrite {
                format!("Rename {old_path} to {new_path} and overwrite if needed")
            } else {
                format!("Rename {old_path} to {new_path}")
            }
        }
        WorkspaceEditOperation::RenameDirectory {
            old_path,
            new_path,
            overwrite,
        } => {
            if *overwrite {
                format!("Rename directory {old_path} to {new_path} and overwrite if needed")
            } else {
                format!("Rename directory {old_path} to {new_path}")
            }
        }
        WorkspaceEditOperation::DeleteFile { path, recursive } => {
            if *recursive {
                format!("Delete {path} recursively")
            } else {
                format!("Delete {path}")
            }
        }
        WorkspaceEditOperation::DeleteDirectory { path, recursive } => {
            if *recursive {
                format!("Delete directory {path} recursively")
            } else {
                format!("Delete directory {path}")
            }
        }
    }
}
