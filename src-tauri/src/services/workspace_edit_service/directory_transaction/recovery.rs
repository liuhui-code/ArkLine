use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::fingerprint::directory_fingerprint;
use super::{
    cleanup, resolve_backup_path, resolve_deleted_path, resolve_paths, resolve_workspace_path,
    sync_directory, sync_rename_parents, DeletedDirectoryEntry, DirectoryJournal,
    RenamedDirectoryEntry, TransactionState, JOURNAL_FILE, SCHEMA_VERSION,
};

pub(super) fn recover_transaction(
    workspace_root: &Path,
    transaction_path: &Path,
) -> Result<(), String> {
    let journal_path = transaction_path.join(JOURNAL_FILE);
    if !journal_path.exists() {
        return cleanup(transaction_path);
    }
    let content = fs::read_to_string(&journal_path).map_err(|error| error.to_string())?;
    if content.is_empty() {
        return cleanup(transaction_path);
    }
    let journal: DirectoryJournal =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    if journal.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Unsupported workspace directory edit journal schema: {}",
            journal.schema_version
        ));
    }
    let paths = resolve_paths(workspace_root, &journal)?;
    match journal.state {
        TransactionState::Prepared => {
            validate_deleted_paths(workspace_root, transaction_path, &journal.deleted_paths)?;
            validate_renamed_paths(workspace_root, transaction_path, &journal.renamed_paths)?;
            remove_created_paths(&paths)?;
            restore_deleted_paths(workspace_root, transaction_path, &journal.deleted_paths)?;
            restore_renamed_paths(workspace_root, transaction_path, &journal.renamed_paths)?;
        }
        TransactionState::Committed => {
            for path in &paths {
                if path.is_file() {
                    return Err(format!(
                        "Workspace directory recovery expected a directory: {}",
                        path.display()
                    ));
                }
                fs::create_dir_all(path).map_err(|error| error.to_string())?;
            }
            validate_committed_deletions(workspace_root, &journal.deleted_paths)?;
            validate_committed_renames(workspace_root, &journal.renamed_paths)?;
        }
    }
    cleanup(transaction_path)
}

fn remove_created_paths(paths: &[PathBuf]) -> Result<(), String> {
    let created = paths.iter().cloned().collect::<HashSet<_>>();
    for path in paths {
        if !path.exists() {
            continue;
        }
        if !path.is_dir() {
            return Err(format!(
                "Workspace directory recovery found an external file: {}",
                path.display()
            ));
        }
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let child = entry.map_err(|error| error.to_string())?.path();
            if !created.contains(&child) {
                return Err(format!(
                    "Workspace directory recovery refused external content: {}",
                    child.display()
                ));
            }
        }
    }
    for path in paths.iter().rev() {
        if path.exists() {
            fs::remove_dir(path).map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
        }
    }
    Ok(())
}

fn validate_deleted_paths(
    workspace_root: &Path,
    transaction_path: &Path,
    entries: &[DeletedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries {
        let path = resolve_deleted_path(workspace_root, entry)?;
        let backup = resolve_backup_path(transaction_path, &entry.backup)?;
        match (path.exists(), backup.exists()) {
            (true, false) if path.is_dir() => {}
            (false, true) if backup.is_dir() => {}
            (true, false) => {
                return Err(format!(
                    "Workspace directory recovery expected a directory: {}",
                    path.display()
                ));
            }
            (false, false) => {
                return Err(format!(
                    "Workspace directory recovery lost both source and backup: {}",
                    path.display()
                ));
            }
            _ => {
                return Err(format!(
                    "Workspace directory recovery refused external content: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

fn restore_deleted_paths(
    workspace_root: &Path,
    transaction_path: &Path,
    entries: &[DeletedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries.iter().rev() {
        let path = resolve_deleted_path(workspace_root, entry)?;
        let backup = resolve_backup_path(transaction_path, &entry.backup)?;
        if backup.exists() {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::rename(&backup, &path).map_err(|error| error.to_string())?;
            sync_rename_parents(&backup, &path)?;
        }
    }
    Ok(())
}

fn validate_committed_deletions(
    workspace_root: &Path,
    entries: &[DeletedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries {
        let path = resolve_deleted_path(workspace_root, entry)?;
        if path.exists() {
            return Err(format!(
                "Workspace directory recovery refused external content: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn validate_renamed_paths(
    workspace_root: &Path,
    transaction_path: &Path,
    entries: &[RenamedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries {
        let old_path = resolve_workspace_path(workspace_root, &entry.old_path)?;
        let new_path = resolve_workspace_path(workspace_root, &entry.new_path)?;
        let backup = resolve_backup_path(transaction_path, &entry.target_backup)?;
        let old = old_path.is_dir();
        let new = new_path.is_dir();
        let backup_exists = backup.is_dir();
        let valid = if entry.target_existed {
            (old && new && !backup_exists)
                || (old && !new && backup_exists)
                || (!old && new && backup_exists)
        } else {
            (old && !new && !backup_exists) || (!old && new && !backup_exists)
        };
        if !valid {
            return Err(format!(
                "Workspace directory rename recovery refused external content: {} -> {}",
                old_path.display(),
                new_path.display()
            ));
        }
        if !old
            && new
            && !entry.source_fingerprint.is_empty()
            && directory_fingerprint(&new_path)? != entry.source_fingerprint
        {
            return Err(format!(
                "Workspace directory rename recovery refused external content: {}",
                new_path.display()
            ));
        }
    }
    Ok(())
}

fn restore_renamed_paths(
    workspace_root: &Path,
    transaction_path: &Path,
    entries: &[RenamedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries.iter().rev() {
        let old_path = resolve_workspace_path(workspace_root, &entry.old_path)?;
        let new_path = resolve_workspace_path(workspace_root, &entry.new_path)?;
        let backup = resolve_backup_path(transaction_path, &entry.target_backup)?;
        if !old_path.exists() {
            fs::rename(&new_path, &old_path).map_err(|error| error.to_string())?;
            sync_rename_parents(&new_path, &old_path)?;
        }
        if backup.exists() {
            fs::rename(&backup, &new_path).map_err(|error| error.to_string())?;
            sync_rename_parents(&backup, &new_path)?;
        }
    }
    Ok(())
}

fn validate_committed_renames(
    workspace_root: &Path,
    entries: &[RenamedDirectoryEntry],
) -> Result<(), String> {
    for entry in entries {
        let old_path = resolve_workspace_path(workspace_root, &entry.old_path)?;
        let new_path = resolve_workspace_path(workspace_root, &entry.new_path)?;
        if old_path.exists() || !new_path.is_dir() {
            return Err(format!(
                "Workspace committed directory rename has an unexpected state: {} -> {}",
                old_path.display(),
                new_path.display()
            ));
        }
    }
    Ok(())
}
