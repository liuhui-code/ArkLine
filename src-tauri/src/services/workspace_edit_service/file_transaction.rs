use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::services::workspace_edit_path_service::normalize_path;

use super::{transaction, ValidatedOperation};

pub(super) fn supports(operations: &[ValidatedOperation]) -> bool {
    !operations.is_empty()
        && operations.iter().all(|operation| match operation {
            ValidatedOperation::Text(_)
            | ValidatedOperation::CreateFile { .. }
            | ValidatedOperation::RenameFile { .. } => true,
            ValidatedOperation::DeleteFile { path, .. } => path.is_file(),
            _ => false,
        })
}

pub(super) fn apply(
    workspace_root: &Path,
    original_file_contents: &BTreeMap<PathBuf, String>,
    updated_file_contents: &BTreeMap<PathBuf, String>,
    operations: &[ValidatedOperation],
) -> Result<BTreeSet<String>, String> {
    let mut original_states = original_file_contents
        .iter()
        .map(|(path, content)| (path.clone(), Some(content.as_bytes().to_vec())))
        .collect::<BTreeMap<_, _>>();
    let mut updated_states = updated_file_contents
        .iter()
        .map(|(path, content)| (path.clone(), Some(content.as_bytes().to_vec())))
        .collect::<BTreeMap<_, _>>();
    for operation in operations {
        collect_operation_states(operation, &mut original_states, &mut updated_states)?;
    }

    let transaction = transaction::prepare(workspace_root, &original_states, &updated_states)?;
    if let Err(error) = transaction.apply_and_commit() {
        let recovery = transaction::recover_pending(workspace_root);
        return match recovery {
            Ok(()) => Err(error),
            Err(recovery_error) => Err(format!(
                "{error}; workspace edit recovery also failed: {recovery_error}"
            )),
        };
    }
    Ok(updated_states
        .keys()
        .map(|path| normalize_path(path))
        .collect())
}

fn collect_operation_states(
    operation: &ValidatedOperation,
    original_states: &mut BTreeMap<PathBuf, Option<Vec<u8>>>,
    updated_states: &mut BTreeMap<PathBuf, Option<Vec<u8>>>,
) -> Result<(), String> {
    match operation {
        ValidatedOperation::CreateFile { path, content } => {
            let original = if path.exists() {
                Some(fs::read(path).map_err(|error| error.to_string())?)
            } else {
                None
            };
            original_states.insert(path.clone(), original);
            updated_states.insert(path.clone(), Some(content.as_bytes().to_vec()));
        }
        ValidatedOperation::DeleteFile { path, .. } => {
            original_states.insert(
                path.clone(),
                Some(fs::read(path).map_err(|error| error.to_string())?),
            );
            updated_states.insert(path.clone(), None);
        }
        ValidatedOperation::RenameFile {
            old_path, new_path, ..
        } => {
            let source = fs::read(old_path).map_err(|error| error.to_string())?;
            let target = if new_path.exists() {
                Some(fs::read(new_path).map_err(|error| error.to_string())?)
            } else {
                None
            };
            original_states.insert(old_path.clone(), Some(source.clone()));
            updated_states.insert(old_path.clone(), None);
            original_states.insert(new_path.clone(), target);
            updated_states.insert(new_path.clone(), Some(source));
        }
        ValidatedOperation::Text(_) => {}
        _ => return Err("Unsupported file transaction operation".to_string()),
    }
    Ok(())
}
