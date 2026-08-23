#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::workspace_edit::{
    ApplyWorkspaceEditResult, EditConflict, WorkspaceEditOperation, WorkspaceEditPlan,
    WorkspaceEditPreview,
};
use crate::services::workspace_edit_path_service::{
    conflict, normalize_path, normalize_workspace_root, text_range_to_byte_offsets,
    validate_parent, validate_workspace_path,
};
use crate::services::workspace_edit_relationship_service::validate_operation_relationships;
use crate::services::workspace_edit_summary_service::{
    collect_affected_files, summarize_operation,
};

mod directory_transaction;
mod file_transaction;
mod transaction;
mod undo;
mod version;

pub use transaction::recover_workspace_edit_transactions;
use version::content_version;

pub fn preview_workspace_edit(
    workspace_root: &Path,
    plan: &WorkspaceEditPlan,
) -> Result<WorkspaceEditPreview, String> {
    let workspace_root = normalize_workspace_root(workspace_root)?;
    let mut conflicts = plan.conflicts.clone();
    let mut validated_operations = Vec::new();
    let mut text_edits_by_file: BTreeMap<PathBuf, Vec<ValidatedTextEdit>> = BTreeMap::new();
    let mut file_contents: BTreeMap<PathBuf, String> = BTreeMap::new();

    for operation in &plan.operations {
        match validate_operation(&workspace_root, operation, &mut file_contents) {
            Ok(validated) => {
                if let ValidatedOperation::Text(edit) = &validated {
                    text_edits_by_file
                        .entry(edit.path.clone())
                        .or_default()
                        .push(edit.clone());
                }
                validated_operations.push(validated);
            }
            Err(conflict) => conflicts.push(conflict),
        }
    }

    for edits in text_edits_by_file.values_mut() {
        edits.sort_by_key(|edit| edit.start);
        for pair in edits.windows(2) {
            if pair[0].end > pair[1].start {
                conflicts.push(EditConflict {
                    path: normalize_path(&pair[0].path),
                    message: "Text edits overlap".to_string(),
                });
            }
        }
    }
    conflicts.extend(validate_operation_relationships(&validated_operations));
    conflicts.extend(validate_transaction_scope(
        &workspace_root,
        &validated_operations,
    ));

    Ok(WorkspaceEditPreview {
        plan: plan.clone(),
        conflicts,
        affected_files: collect_affected_files(plan),
        summary: plan.operations.iter().map(summarize_operation).collect(),
    })
}

pub fn apply_workspace_edit(
    workspace_root: &Path,
    plan: &WorkspaceEditPlan,
) -> Result<ApplyWorkspaceEditResult, String> {
    let workspace_root = normalize_workspace_root(workspace_root)?;
    let _guard = transaction::lock_workspace_edits()?;
    transaction::recover_pending(&workspace_root)?;
    directory_transaction::recover_pending(&workspace_root)?;

    if !plan.conflicts.is_empty() {
        return Ok(ApplyWorkspaceEditResult {
            applied: false,
            conflicts: plan.conflicts.clone(),
            changed_files: Vec::new(),
            undo_plan: None,
        });
    }

    let mut conflicts = Vec::new();
    let mut validated_operations = Vec::new();
    let mut text_edits_by_file: BTreeMap<PathBuf, Vec<ValidatedTextEdit>> = BTreeMap::new();
    let mut file_contents: BTreeMap<PathBuf, String> = BTreeMap::new();

    for operation in &plan.operations {
        match validate_operation(&workspace_root, operation, &mut file_contents) {
            Ok(validated) => {
                if let ValidatedOperation::Text(edit) = &validated {
                    text_edits_by_file
                        .entry(edit.path.clone())
                        .or_default()
                        .push(edit.clone());
                }
                validated_operations.push(validated);
            }
            Err(conflict) => conflicts.push(conflict),
        }
    }

    for edits in text_edits_by_file.values_mut() {
        edits.sort_by_key(|edit| edit.start);
        for pair in edits.windows(2) {
            if pair[0].end > pair[1].start {
                conflicts.push(EditConflict {
                    path: normalize_path(&pair[0].path),
                    message: "Text edits overlap".to_string(),
                });
            }
        }
    }
    conflicts.extend(validate_operation_relationships(&validated_operations));
    conflicts.extend(validate_transaction_scope(
        &workspace_root,
        &validated_operations,
    ));

    if !conflicts.is_empty() {
        return Ok(ApplyWorkspaceEditResult {
            applied: false,
            conflicts,
            changed_files: Vec::new(),
            undo_plan: None,
        });
    }

    let original_file_contents = file_contents.clone();

    for (path, edits) in &mut text_edits_by_file {
        let content = file_contents
            .get_mut(path)
            .ok_or_else(|| format!("Text edit content was not loaded: {}", path.display()))?;
        edits.sort_by(|left, right| right.start.cmp(&left.start));

        for edit in edits {
            content.replace_range(edit.start..edit.end, &edit.new_text);
        }
    }

    let mut changed_files = BTreeSet::new();
    if file_transaction::supports(&validated_operations) {
        changed_files.extend(file_transaction::apply(
            &workspace_root,
            &original_file_contents,
            &file_contents,
            &validated_operations,
        )?);
    } else if directory_transaction::supports(&validated_operations) {
        changed_files.extend(directory_transaction::apply(
            &workspace_root,
            &validated_operations,
        )?);
    } else if !validated_operations.is_empty() {
        return Err("Workspace edit has no crash-safe transaction strategy".to_string());
    }

    let undo_plan = undo::build_text_undo_plan(plan, &original_file_contents, &file_contents);

    Ok(ApplyWorkspaceEditResult {
        applied: true,
        conflicts: Vec::new(),
        changed_files: changed_files.into_iter().collect(),
        undo_plan,
    })
}

fn validate_transaction_scope(
    workspace_root: &Path,
    operations: &[ValidatedOperation],
) -> Vec<EditConflict> {
    let has_file_operations = operations.iter().any(|operation| match operation {
        ValidatedOperation::Text(_)
        | ValidatedOperation::CreateFile { .. }
        | ValidatedOperation::RenameFile { .. } => true,
        ValidatedOperation::DeleteFile { path, .. } => path.is_file(),
        _ => false,
    });
    let has_directory_operations = operations.iter().any(|operation| match operation {
        ValidatedOperation::CreateDirectory { .. }
        | ValidatedOperation::RenameDirectory { .. }
        | ValidatedOperation::DeleteDirectory { .. } => true,
        ValidatedOperation::DeleteFile { path, .. } => path.is_dir(),
        _ => false,
    });
    if has_file_operations && has_directory_operations {
        vec![EditConflict {
            path: normalize_path(workspace_root),
            message: "Workspace edit cannot mix file and directory operations atomically"
                .to_string(),
        }]
    } else {
        Vec::new()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedTextEdit {
    pub(crate) path: PathBuf,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) new_text: String,
}

#[derive(Debug, Clone)]
pub(crate) enum ValidatedOperation {
    Text(ValidatedTextEdit),
    CreateFile {
        path: PathBuf,
        content: String,
    },
    CreateDirectory {
        path: PathBuf,
    },
    RenameFile {
        old_path: PathBuf,
        new_path: PathBuf,
        overwrite: bool,
    },
    RenameDirectory {
        old_path: PathBuf,
        new_path: PathBuf,
        overwrite: bool,
    },
    DeleteFile {
        path: PathBuf,
        recursive: bool,
    },
    DeleteDirectory {
        path: PathBuf,
        recursive: bool,
    },
}

fn validate_operation(
    workspace_root: &Path,
    operation: &WorkspaceEditOperation,
    file_contents: &mut BTreeMap<PathBuf, String>,
) -> Result<ValidatedOperation, EditConflict> {
    match operation {
        WorkspaceEditOperation::Text {
            path,
            range,
            new_text,
            expected_version,
            expected_content_version,
        } => {
            let path = validate_workspace_path(workspace_root, path)?;
            if expected_version.is_some() {
                return Err(conflict(
                    &path,
                    "expectedVersion is not supported by the workspace edit runtime yet",
                ));
            }
            if !path.exists() {
                return Err(conflict(&path, "Text edit target does not exist"));
            }
            if path.is_dir() {
                return Err(conflict(&path, "Text edit target is a directory"));
            }

            if !file_contents.contains_key(&path) {
                let content = fs::read_to_string(&path)
                    .map_err(|error| conflict(&path, error.to_string()))?;
                file_contents.insert(path.clone(), content);
            }

            let content = file_contents
                .get(&path)
                .expect("content should be loaded before range validation");
            if let Some(expected) = expected_content_version {
                let actual = content_version(content);
                if &actual != expected {
                    return Err(conflict(
                        &path,
                        format!(
                            "expectedContentVersion mismatch: expected {expected}, received {actual}"
                        ),
                    ));
                }
            }
            let (start, end) = text_range_to_byte_offsets(content, range)
                .map_err(|message| conflict(&path, message))?;

            Ok(ValidatedOperation::Text(ValidatedTextEdit {
                path,
                start,
                end,
                new_text: new_text.clone(),
            }))
        }
        WorkspaceEditOperation::CreateFile {
            path,
            content,
            overwrite,
        } => {
            let path = validate_workspace_path(workspace_root, path)?;
            validate_parent(&path)?;

            if path.is_dir() {
                return Err(conflict(&path, "Create file target is a directory"));
            }
            if path.exists() && !overwrite {
                return Err(conflict(&path, "Create file target already exists"));
            }

            Ok(ValidatedOperation::CreateFile {
                path,
                content: content.clone(),
            })
        }
        WorkspaceEditOperation::CreateDirectory { path } => {
            let path = validate_workspace_path(workspace_root, path)?;
            validate_parent(&path)?;

            if path.is_file() {
                return Err(conflict(&path, "Create directory target is a file"));
            }
            if path.exists() {
                return Err(conflict(&path, "Create directory target already exists"));
            }

            Ok(ValidatedOperation::CreateDirectory { path })
        }
        WorkspaceEditOperation::RenameFile {
            old_path,
            new_path,
            overwrite,
        } => {
            let old_path = validate_workspace_path(workspace_root, old_path)?;
            let new_path = validate_workspace_path(workspace_root, new_path)?;
            validate_parent(&new_path)?;

            if !old_path.exists() {
                return Err(conflict(&old_path, "Rename source does not exist"));
            }
            if old_path.is_dir() {
                return Err(conflict(&old_path, "Rename source is a directory"));
            }
            if old_path == new_path {
                return Err(conflict(
                    &old_path,
                    "Rename source and target are the same path",
                ));
            }
            if new_path.is_dir() {
                return Err(conflict(&new_path, "Rename target is a directory"));
            }
            if new_path.exists() && !overwrite {
                return Err(conflict(&new_path, "Rename target already exists"));
            }

            Ok(ValidatedOperation::RenameFile {
                old_path,
                new_path,
                overwrite: *overwrite,
            })
        }
        WorkspaceEditOperation::RenameDirectory {
            old_path,
            new_path,
            overwrite,
        } => {
            let old_path = validate_workspace_path(workspace_root, old_path)?;
            let new_path = validate_workspace_path(workspace_root, new_path)?;
            validate_parent(&new_path)?;

            if !old_path.exists() {
                return Err(conflict(
                    &old_path,
                    "Rename directory source does not exist",
                ));
            }
            if old_path.is_file() {
                return Err(conflict(&old_path, "Rename directory source is a file"));
            }
            if old_path == new_path {
                return Err(conflict(
                    &old_path,
                    "Rename directory source and target are the same path",
                ));
            }
            if new_path.is_file() {
                return Err(conflict(&new_path, "Rename directory target is a file"));
            }
            if new_path.exists() && !overwrite {
                return Err(conflict(
                    &new_path,
                    "Rename directory target already exists",
                ));
            }

            Ok(ValidatedOperation::RenameDirectory {
                old_path,
                new_path,
                overwrite: *overwrite,
            })
        }
        WorkspaceEditOperation::DeleteFile { path, recursive } => {
            let path = validate_workspace_path(workspace_root, path)?;
            if path == workspace_root {
                return Err(conflict(
                    &path,
                    "Delete target cannot be the workspace root",
                ));
            }
            if !path.exists() {
                return Err(conflict(&path, "Delete target does not exist"));
            }
            if path.is_dir() && !recursive {
                return Err(conflict(
                    &path,
                    "Delete target is a directory; recursive=true is required",
                ));
            }

            Ok(ValidatedOperation::DeleteFile {
                path,
                recursive: *recursive,
            })
        }
        WorkspaceEditOperation::DeleteDirectory { path, recursive } => {
            let path = validate_workspace_path(workspace_root, path)?;
            if path == workspace_root {
                return Err(conflict(
                    &path,
                    "Delete directory target cannot be the workspace root",
                ));
            }
            if !path.exists() {
                return Err(conflict(&path, "Delete directory target does not exist"));
            }
            if path.is_file() {
                return Err(conflict(&path, "Delete directory target is a file"));
            }

            Ok(ValidatedOperation::DeleteDirectory {
                path,
                recursive: *recursive,
            })
        }
    }
}
