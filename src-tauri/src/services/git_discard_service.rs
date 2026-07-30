use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{GitPathsRequest, GitRestoreDiscardRequest};
use crate::services::process_command_service::hidden_command;

static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn discard_paths(root: &Path, request: &GitPathsRequest) -> Result<String, String> {
    require_head(root)?;
    let backup = backup_paths(root, &request.paths)?;
    for path in &request.paths {
        if is_tracked(root, path) {
            run_git(root, &["restore", "--worktree", "--", path])?;
        } else {
            remove_worktree_path(root, path)?;
        }
    }
    Ok(backup)
}

pub fn restore_discard(root: &Path, request: &GitRestoreDiscardRequest) -> Result<(), String> {
    validate_commit(&request.backup_commit)?;
    if request.paths.is_empty() {
        return Err("Discard backup has no paths to restore".to_string());
    }
    for path in &request.paths {
        if has_new_worktree_changes(root, path)? {
            return Err(format!(
                "Cannot undo discard because {path} changed after the backup was created"
            ));
        }
    }
    let mut existing = Vec::new();
    let mut deleted = Vec::new();
    for path in &request.paths {
        if exists_in_commit(root, &request.backup_commit, path) {
            existing.push(path.as_str());
        } else {
            deleted.push(path.as_str());
        }
    }
    if !existing.is_empty() {
        let source = format!("--source={}", request.backup_commit);
        let mut args = vec!["restore", source.as_str(), "--worktree", "--"];
        args.extend(existing);
        run_git(root, &args)?;
    }
    for path in deleted {
        remove_worktree_path(root, path)?;
    }
    Ok(())
}

pub fn backup_paths(root: &Path, paths: &[String]) -> Result<String, String> {
    require_head(root)?;
    let git_dir = PathBuf::from(run_git(root, &["rev-parse", "--absolute-git-dir"])?.trim());
    let suffix = backup_suffix();
    let temporary_index = git_dir.join(format!("arkline-discard-index-{suffix}"));
    let result = (|| {
        run_git_with_index(root, &temporary_index, &["read-tree", "HEAD"])?;
        let mut add_args = vec!["add", "-A", "--"];
        add_args.extend(paths.iter().map(String::as_str));
        run_git_with_index(root, &temporary_index, &add_args)?;
        let tree = run_git_with_index(root, &temporary_index, &["write-tree"])?;
        let head = run_git(root, &["rev-parse", "HEAD"])?;
        let commit = run_commit_tree(root, tree.trim(), head.trim())?;
        let reference = format!("refs/arkline/discard/{suffix}");
        run_git(root, &["update-ref", &reference, commit.trim()])?;
        Ok(commit.trim().to_string())
    })();
    let _ = fs::remove_file(temporary_index);
    result
}

fn run_commit_tree(root: &Path, tree: &str, parent: &str) -> Result<String, String> {
    let output = hidden_command("git")
        .args([
            "commit-tree",
            tree,
            "-p",
            parent,
            "-m",
            "ArkLine discard backup",
        ])
        .current_dir(root)
        .env("GIT_AUTHOR_NAME", "ArkLine")
        .env("GIT_AUTHOR_EMAIL", "arkline@local.invalid")
        .env("GIT_COMMITTER_NAME", "ArkLine")
        .env("GIT_COMMITTER_EMAIL", "arkline@local.invalid")
        .output()
        .map_err(|error| error.to_string())?;
    command_text(output, "Could not create the discard safety commit")
}

fn run_git_with_index(root: &Path, index: &Path, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
        .args(args)
        .current_dir(root)
        .env("GIT_INDEX_FILE", index)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| error.to_string())?;
    command_text(output, "Git discard backup failed")
}

fn has_new_worktree_changes(root: &Path, path: &str) -> Result<bool, String> {
    let diff = hidden_command("git")
        .args(["diff", "--quiet", "--", path])
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;
    if !diff.status.success() && diff.status.code() != Some(1) {
        return command_text(diff, "Could not inspect the working tree").map(|_| false);
    }
    let untracked = run_git(
        root,
        &["ls-files", "--others", "--exclude-standard", "--", path],
    )?;
    Ok(diff.status.code() == Some(1) || !untracked.trim().is_empty())
}

fn exists_in_commit(root: &Path, commit: &str, path: &str) -> bool {
    hidden_command("git")
        .args(["ls-tree", "-z", "-r", commit, "--", path])
        .current_dir(root)
        .output()
        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
}

fn is_tracked(root: &Path, path: &str) -> bool {
    hidden_command("git")
        .args(["ls-files", "--error-unmatch", "--", path])
        .current_dir(root)
        .output()
        .is_ok_and(|output| output.status.success())
}

fn remove_worktree_path(root: &Path, path: &str) -> Result<(), String> {
    let target = root.join(path);
    let Ok(metadata) = fs::symlink_metadata(&target) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())
    } else {
        fs::remove_file(target).map_err(|error| error.to_string())
    }
}

fn require_head(root: &Path) -> Result<(), String> {
    if run_git(root, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        Ok(())
    } else {
        Err(
            "Safe discard requires an initial commit. Commit or remove the file manually."
                .to_string(),
        )
    }
}

fn backup_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{nanos}-{sequence}", std::process::id())
}

fn validate_commit(commit: &str) -> Result<(), String> {
    if (40..=64).contains(&commit.len()) && commit.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Discard backup identifier is invalid".to_string())
    }
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| error.to_string())?;
    command_text(output, "Git discard operation failed")
}

fn command_text(output: std::process::Output, fallback: &str) -> Result<String, String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        fallback.to_string()
    } else {
        message
    })
}

#[cfg(test)]
mod tests {
    use super::validate_commit;

    #[test]
    fn validates_full_git_object_identifiers() {
        assert!(validate_commit("0123456789012345678901234567890123456789").is_ok());
        assert!(validate_commit("stash@{0}").is_err());
    }
}

#[cfg(test)]
#[path = "git_discard_service_tests.rs"]
mod integration_tests;
