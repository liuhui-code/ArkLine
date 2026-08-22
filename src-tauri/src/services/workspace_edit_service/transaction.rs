use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

use crate::services::document_service::{write_file_bytes, write_text_file};
use crate::services::workspace_edit_path_service::{
    normalize_workspace_root, validate_workspace_path,
};

const JOURNAL_SCHEMA_VERSION: u32 = 3;
const TRANSACTION_DIRECTORY: &str = "workspace-edits";
const JOURNAL_FILE: &str = "journal.json";

static WORKSPACE_EDIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn recover_workspace_edit_transactions(workspace_root: &Path) -> Result<(), String> {
    let workspace_root = normalize_workspace_root(workspace_root)?;
    let _guard = lock_workspace_edits()?;
    recover_pending(&workspace_root)?;
    super::directory_transaction::recover_pending(&workspace_root)
}

pub(super) fn lock_workspace_edits() -> Result<MutexGuard<'static, ()>, String> {
    WORKSPACE_EDIT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Workspace edit lock is poisoned".to_string())
}

pub(super) fn prepare(
    workspace_root: &Path,
    original_contents: &BTreeMap<PathBuf, Option<Vec<u8>>>,
    updated_contents: &BTreeMap<PathBuf, Option<Vec<u8>>>,
) -> Result<PreparedTransaction, String> {
    let transaction_path = transaction_root(workspace_root).join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&transaction_path).map_err(|error| error.to_string())?;
    if let Some(parent) = transaction_path.parent() {
        sync_directory(parent)?;
        if let Some(grandparent) = parent.parent() {
            sync_directory(grandparent)?;
        }
    }
    exit_after_transaction_directory_if_requested();
    let entries = updated_contents
        .iter()
        .enumerate()
        .map(|(index, (path, updated_content))| {
            let relative_path = path
                .strip_prefix(workspace_root)
                .map_err(|_| format!("Transaction path escaped workspace: {}", path.display()))?;
            let original_content = original_contents
                .get(path)
                .ok_or_else(|| format!("Missing original content for {}", path.display()))?;
            Ok(TransactionEntry {
                path: relative_path.to_string_lossy().to_string(),
                original_content: None,
                updated_content: None,
                original_blob: persist_blob(
                    &transaction_path,
                    &format!("{index}-before.bin"),
                    original_content.as_deref(),
                )?,
                updated_blob: persist_blob(
                    &transaction_path,
                    &format!("{index}-after.bin"),
                    updated_content.as_deref(),
                )?,
            })
        })
        .collect::<Result<Vec<_>, String>>();
    let entries = match entries {
        Ok(entries) => entries,
        Err(error) => {
            let _ = cleanup_transaction(&transaction_path);
            return Err(error);
        }
    };
    sync_directory(&transaction_path)?;
    let journal_path = transaction_path.join(JOURNAL_FILE);
    let placeholder_result = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&journal_path)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string());
    if let Err(error) = placeholder_result {
        let _ = cleanup_transaction(&transaction_path);
        return Err(error);
    }
    sync_directory(&transaction_path)?;
    exit_after_journal_placeholder_if_requested();
    let journal = TransactionJournal {
        schema_version: JOURNAL_SCHEMA_VERSION,
        state: TransactionState::Prepared,
        entries,
    };
    if let Err(error) = persist_journal(&journal_path, &journal) {
        let _ = cleanup_transaction(&transaction_path);
        return Err(error);
    }
    Ok(PreparedTransaction {
        workspace_root: workspace_root.to_path_buf(),
        transaction_path,
        journal_path,
        journal,
    })
}

pub(super) fn recover_pending(workspace_root: &Path) -> Result<(), String> {
    let root = transaction_root(workspace_root);
    if !root.exists() {
        return Ok(());
    }
    let mut transaction_paths = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    transaction_paths.sort();
    for transaction_path in transaction_paths {
        recover_transaction(workspace_root, &transaction_path)?;
    }
    remove_empty_transaction_root(&root)
}

pub(super) struct PreparedTransaction {
    workspace_root: PathBuf,
    transaction_path: PathBuf,
    journal_path: PathBuf,
    journal: TransactionJournal,
}

impl PreparedTransaction {
    pub(super) fn apply_and_commit(mut self) -> Result<(), String> {
        for (index, entry) in self.journal.entries.iter().enumerate() {
            let path = resolve_entry_path(&self.workspace_root, entry)?;
            let updated = load_entry_state(&self.transaction_path, entry, false)?;
            apply_file_state(&path, updated.as_deref())?;
            exit_after_replacement_if_requested(index + 1);
        }
        self.journal.state = TransactionState::Committed;
        persist_journal(&self.journal_path, &self.journal)?;
        exit_after_commit_if_requested();
        cleanup_transaction(&self.transaction_path)
    }
}

fn recover_transaction(workspace_root: &Path, transaction_path: &Path) -> Result<(), String> {
    let journal_path = transaction_path.join(JOURNAL_FILE);
    if !journal_path.exists() {
        return cleanup_transaction(transaction_path);
    }
    let journal_text = fs::read_to_string(&journal_path).map_err(|error| {
        format!(
            "Cannot read workspace edit journal {}: {error}",
            journal_path.display()
        )
    })?;
    if journal_text.is_empty() {
        return cleanup_transaction(transaction_path);
    }
    let journal: TransactionJournal = serde_json::from_str(&journal_text).map_err(|error| {
        format!(
            "Cannot parse workspace edit journal {}: {error}",
            journal_path.display()
        )
    })?;
    if !matches!(journal.schema_version, 1 | 2 | JOURNAL_SCHEMA_VERSION) {
        return Err(format!(
            "Unsupported workspace edit journal schema: {}",
            journal.schema_version
        ));
    }

    let resolved = journal
        .entries
        .iter()
        .map(|entry| {
            let path = resolve_entry_path(workspace_root, entry)?;
            let original = load_entry_state(transaction_path, entry, true)?;
            let updated = load_entry_state(transaction_path, entry, false)?;
            let actual = read_file_state(&path)?;
            if actual != original && actual != updated {
                return Err(format!(
                    "Workspace edit recovery refused externally changed file: {}",
                    path.display()
                ));
            }
            Ok((path, original, updated))
        })
        .collect::<Result<Vec<_>, String>>()?;

    for (path, original, updated) in resolved {
        let recovery_content = match journal.state {
            TransactionState::Prepared => original.as_deref(),
            TransactionState::Committed => updated.as_deref(),
        };
        apply_file_state(&path, recovery_content)?;
    }
    cleanup_transaction(transaction_path)
}

fn read_file_state(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    if path.is_dir() {
        return Err(format!(
            "Workspace edit recovery expected a file but found a directory: {}",
            path.display()
        ));
    }
    fs::read(path).map(Some).map_err(|error| error.to_string())
}

fn apply_file_state(path: &Path, content: Option<&[u8]>) -> Result<(), String> {
    match content {
        Some(content) => write_file_bytes(path, content),
        None if !path.exists() => Ok(()),
        None if path.is_dir() => Err(format!(
            "Workspace edit expected a file but found a directory: {}",
            path.display()
        )),
        None => {
            fs::remove_file(path).map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
            Ok(())
        }
    }
}

fn resolve_entry_path(workspace_root: &Path, entry: &TransactionEntry) -> Result<PathBuf, String> {
    validate_workspace_path(workspace_root, &entry.path)
        .map_err(|conflict| format!("{}: {}", conflict.path, conflict.message))
}

fn persist_blob(
    transaction_path: &Path,
    file_name: &str,
    content: Option<&[u8]>,
) -> Result<Option<String>, String> {
    let Some(content) = content else {
        return Ok(None);
    };
    let path = transaction_path.join(file_name);
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(content).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(Some(file_name.to_string()))
}

fn load_entry_state(
    transaction_path: &Path,
    entry: &TransactionEntry,
    original: bool,
) -> Result<Option<Vec<u8>>, String> {
    let (inline, blob) = if original {
        (&entry.original_content, &entry.original_blob)
    } else {
        (&entry.updated_content, &entry.updated_blob)
    };
    if let Some(blob) = blob {
        let blob_path = resolve_blob_path(transaction_path, blob)?;
        return fs::read(&blob_path).map(Some).map_err(|error| {
            format!(
                "Cannot read workspace edit blob {}: {error}",
                blob_path.display()
            )
        });
    }
    Ok(inline.as_ref().map(|content| content.as_bytes().to_vec()))
}

fn resolve_blob_path(transaction_path: &Path, blob: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let candidate = Path::new(blob);
    let mut components = candidate.components();
    let valid = matches!(components.next(), Some(Component::Normal(name)) if name == blob)
        && components.next().is_none();
    if !valid {
        return Err(format!("Invalid workspace edit blob path: {blob}"));
    }
    Ok(transaction_path.join(candidate))
}

fn persist_journal(path: &Path, journal: &TransactionJournal) -> Result<(), String> {
    let content = serde_json::to_string(journal).map_err(|error| error.to_string())?;
    write_text_file(path, &content)
}

fn cleanup_transaction(transaction_path: &Path) -> Result<(), String> {
    fs::remove_dir_all(transaction_path).map_err(|error| error.to_string())?;
    if let Some(parent) = transaction_path.parent() {
        sync_directory(parent)?;
        remove_empty_transaction_root(parent)?;
    }
    Ok(())
}

fn remove_empty_transaction_root(root: &Path) -> Result<(), String> {
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
fn exit_after_replacement_if_requested(replacement_count: usize) {
    let requested = std::env::var("ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_REPLACEMENTS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok());
    if requested == Some(replacement_count) {
        std::process::exit(86);
    }
}

#[cfg(not(test))]
fn exit_after_replacement_if_requested(_replacement_count: usize) {}

#[cfg(test)]
fn exit_after_commit_if_requested() {
    if std::env::var("ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_COMMIT").as_deref() == Ok("1") {
        std::process::exit(87);
    }
}

#[cfg(not(test))]
fn exit_after_commit_if_requested() {}

#[cfg(test)]
fn exit_after_transaction_directory_if_requested() {
    if std::env::var("ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_TRANSACTION_DIRECTORY").as_deref()
        == Ok("1")
    {
        std::process::exit(85);
    }
}

#[cfg(not(test))]
fn exit_after_transaction_directory_if_requested() {}

#[cfg(test)]
fn exit_after_journal_placeholder_if_requested() {
    if std::env::var("ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_JOURNAL_PLACEHOLDER").as_deref()
        == Ok("1")
    {
        std::process::exit(84);
    }
}

#[cfg(not(test))]
fn exit_after_journal_placeholder_if_requested() {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionJournal {
    schema_version: u32,
    state: TransactionState,
    entries: Vec<TransactionEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TransactionState {
    Prepared,
    Committed,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionEntry {
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_blob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_blob: Option<String>,
}
