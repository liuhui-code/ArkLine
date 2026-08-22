use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::services::document_service::write_text_file;
use crate::services::workspace_edit_path_service::{normalize_path, validate_workspace_path};

use super::ValidatedOperation;

mod fingerprint;
mod recovery;

const SCHEMA_VERSION: u32 = 1;
const TRANSACTION_DIRECTORY: &str = "workspace-directory-edits";
const JOURNAL_FILE: &str = "journal.json";

pub(super) fn supports(operations: &[ValidatedOperation]) -> bool {
    !operations.is_empty()
        && operations.iter().all(|operation| match operation {
            ValidatedOperation::CreateDirectory { .. }
            | ValidatedOperation::DeleteDirectory { .. }
            | ValidatedOperation::RenameDirectory { .. } => true,
            ValidatedOperation::DeleteFile { path, .. } => path.is_dir(),
            _ => false,
        })
}

pub(super) fn apply(
    workspace_root: &Path,
    operations: &[ValidatedOperation],
) -> Result<BTreeSet<String>, String> {
    let mut created_paths = BTreeSet::new();
    let mut deleted_paths = Vec::new();
    let mut renamed_paths = Vec::new();
    let mut changed = BTreeSet::new();
    for operation in operations {
        match operation {
            ValidatedOperation::CreateDirectory { path } => {
                changed.insert(normalize_path(path));
                collect_missing_ancestors(workspace_root, path, &mut created_paths)?;
            }
            ValidatedOperation::DeleteDirectory { path, .. }
            | ValidatedOperation::DeleteFile { path, .. }
                if path.is_dir() =>
            {
                changed.insert(normalize_path(path));
                deleted_paths.push(path.clone());
            }
            ValidatedOperation::RenameDirectory {
                old_path, new_path, ..
            } => {
                changed.insert(normalize_path(old_path));
                changed.insert(normalize_path(new_path));
                renamed_paths.push((old_path.clone(), new_path.clone()));
            }
            _ => return Err("Unsupported directory transaction operation".to_string()),
        }
    }
    let mut transaction = prepare(workspace_root, created_paths, deleted_paths, renamed_paths)?;
    if let Err(error) = transaction.apply_and_commit() {
        let recovery = recover_pending(workspace_root);
        return match recovery {
            Ok(()) => Err(error),
            Err(recovery_error) => Err(format!(
                "{error}; workspace directory edit recovery also failed: {recovery_error}"
            )),
        };
    }
    Ok(changed)
}

pub(super) fn recover_pending(workspace_root: &Path) -> Result<(), String> {
    let root = transaction_root(workspace_root);
    if !root.exists() {
        return Ok(());
    }
    let mut transactions = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    transactions.sort();
    for transaction in transactions {
        recovery::recover_transaction(workspace_root, &transaction)?;
    }
    remove_empty_root(&root)
}

fn collect_missing_ancestors(
    workspace_root: &Path,
    target: &Path,
    paths: &mut BTreeSet<PathBuf>,
) -> Result<(), String> {
    let mut current = target.to_path_buf();
    while current != workspace_root && !current.exists() {
        paths.insert(current.clone());
        current = current
            .parent()
            .ok_or_else(|| format!("Directory path has no parent: {}", current.display()))?
            .to_path_buf();
    }
    Ok(())
}

fn prepare(
    workspace_root: &Path,
    paths: BTreeSet<PathBuf>,
    deleted_paths: Vec<PathBuf>,
    renamed_paths: Vec<(PathBuf, PathBuf)>,
) -> Result<PreparedDirectoryTransaction, String> {
    let transaction_path = transaction_root(workspace_root).join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&transaction_path).map_err(|error| error.to_string())?;
    sync_directory(&transaction_path)?;
    if let Some(parent) = transaction_path.parent() {
        sync_directory(parent)?;
    }
    let journal_path = transaction_path.join(JOURNAL_FILE);
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&journal_path)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    sync_directory(&transaction_path)?;
    let journal = DirectoryJournal {
        schema_version: SCHEMA_VERSION,
        state: TransactionState::Prepared,
        created_paths: paths
            .into_iter()
            .map(|path| {
                path.strip_prefix(workspace_root)
                    .map(|path| path.to_string_lossy().to_string())
                    .map_err(|_| {
                        format!(
                            "Directory transaction escaped workspace: {}",
                            path.display()
                        )
                    })
            })
            .collect::<Result<Vec<_>, _>>()?,
        deleted_paths: deleted_paths
            .into_iter()
            .enumerate()
            .map(|(index, path)| {
                Ok(DeletedDirectoryEntry {
                    path: path
                        .strip_prefix(workspace_root)
                        .map_err(|_| {
                            format!(
                                "Directory transaction escaped workspace: {}",
                                path.display()
                            )
                        })?
                        .to_string_lossy()
                        .to_string(),
                    backup: format!("deleted-{index}"),
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        renamed_paths: renamed_paths
            .into_iter()
            .enumerate()
            .map(|(index, (old_path, new_path))| {
                Ok(RenamedDirectoryEntry {
                    old_path: relative_path(workspace_root, &old_path)?,
                    new_path: relative_path(workspace_root, &new_path)?,
                    target_backup: format!("rename-target-{index}"),
                    target_existed: new_path.exists(),
                    source_fingerprint: fingerprint::directory_fingerprint(&old_path)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
    };
    persist_journal(&journal_path, &journal)?;
    Ok(PreparedDirectoryTransaction {
        workspace_root: workspace_root.to_path_buf(),
        transaction_path,
        journal_path,
        journal,
    })
}

struct PreparedDirectoryTransaction {
    workspace_root: PathBuf,
    transaction_path: PathBuf,
    journal_path: PathBuf,
    journal: DirectoryJournal,
}

impl PreparedDirectoryTransaction {
    fn apply_and_commit(&mut self) -> Result<(), String> {
        let paths = resolve_paths(&self.workspace_root, &self.journal)?;
        for path in &paths {
            fs::create_dir(path).map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
        }
        let mut operation_count = usize::from(!paths.is_empty());
        if operation_count > 0 {
            exit_after_operation_if_requested(operation_count);
        }
        for entry in &self.journal.deleted_paths {
            let path = resolve_deleted_path(&self.workspace_root, entry)?;
            let backup = resolve_backup_path(&self.transaction_path, &entry.backup)?;
            fs::rename(&path, &backup).map_err(|error| error.to_string())?;
            sync_rename_parents(&path, &backup)?;
            operation_count += 1;
            exit_after_operation_if_requested(operation_count);
        }
        for entry in &self.journal.renamed_paths {
            let old_path = resolve_workspace_path(&self.workspace_root, &entry.old_path)?;
            let new_path = resolve_workspace_path(&self.workspace_root, &entry.new_path)?;
            let backup = resolve_backup_path(&self.transaction_path, &entry.target_backup)?;
            if entry.target_existed {
                fs::rename(&new_path, &backup).map_err(|error| error.to_string())?;
                sync_rename_parents(&new_path, &backup)?;
            }
            fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
            sync_rename_parents(&old_path, &new_path)?;
            operation_count += 1;
            exit_after_operation_if_requested(operation_count);
        }
        self.journal.state = TransactionState::Committed;
        persist_journal(&self.journal_path, &self.journal)?;
        cleanup(&self.transaction_path)
    }
}

fn resolve_deleted_path(
    workspace_root: &Path,
    entry: &DeletedDirectoryEntry,
) -> Result<PathBuf, String> {
    validate_workspace_path(workspace_root, &entry.path)
        .map_err(|conflict| format!("{}: {}", conflict.path, conflict.message))
}

fn resolve_workspace_path(workspace_root: &Path, path: &str) -> Result<PathBuf, String> {
    validate_workspace_path(workspace_root, path)
        .map_err(|conflict| format!("{}: {}", conflict.path, conflict.message))
}

fn relative_path(workspace_root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(workspace_root)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|_| {
            format!(
                "Directory transaction escaped workspace: {}",
                path.display()
            )
        })
}

fn resolve_backup_path(transaction_path: &Path, backup: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let mut components = Path::new(backup).components();
    let valid = matches!(components.next(), Some(Component::Normal(name)) if name == backup)
        && components.next().is_none();
    if !valid {
        return Err(format!("Invalid workspace directory backup path: {backup}"));
    }
    Ok(transaction_path.join(backup))
}

fn sync_rename_parents(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = from.parent() {
        sync_directory(parent)?;
    }
    if let Some(parent) = to.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn resolve_paths(
    workspace_root: &Path,
    journal: &DirectoryJournal,
) -> Result<Vec<PathBuf>, String> {
    let mut paths = journal
        .created_paths
        .iter()
        .map(|path| {
            validate_workspace_path(workspace_root, path)
                .map_err(|conflict| format!("{}: {}", conflict.path, conflict.message))
        })
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort_by_key(|path| path.components().count());
    Ok(paths)
}

fn persist_journal(path: &Path, journal: &DirectoryJournal) -> Result<(), String> {
    let content = serde_json::to_string(journal).map_err(|error| error.to_string())?;
    write_text_file(path, &content)
}

fn cleanup(transaction_path: &Path) -> Result<(), String> {
    fs::remove_dir_all(transaction_path).map_err(|error| error.to_string())?;
    if let Some(parent) = transaction_path.parent() {
        sync_directory(parent)?;
        remove_empty_root(parent)?;
    }
    Ok(())
}

fn remove_empty_root(root: &Path) -> Result<(), String> {
    if root.exists()
        && fs::read_dir(root)
            .map_err(|error| error.to_string())?
            .next()
            .is_none()
    {
        fs::remove_dir(root).map_err(|error| error.to_string())?;
        if let Some(parent) = root.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn transaction_root(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".arkline").join(TRANSACTION_DIRECTORY)
}

#[cfg(test)]
fn exit_after_operation_if_requested(operation_count: usize) {
    let requested = std::env::var("ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_REPLACEMENTS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok());
    if requested == Some(operation_count) {
        std::process::exit(86);
    }
}

#[cfg(not(test))]
fn exit_after_operation_if_requested(_operation_count: usize) {}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryJournal {
    schema_version: u32,
    state: TransactionState,
    #[serde(default)]
    created_paths: Vec<String>,
    #[serde(default)]
    deleted_paths: Vec<DeletedDirectoryEntry>,
    #[serde(default)]
    renamed_paths: Vec<RenamedDirectoryEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeletedDirectoryEntry {
    path: String,
    backup: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamedDirectoryEntry {
    old_path: String,
    new_path: String,
    target_backup: String,
    target_existed: bool,
    #[serde(default)]
    source_fingerprint: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TransactionState {
    Prepared,
    Committed,
}
