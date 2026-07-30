use std::fs;
use std::path::{Path, PathBuf};

use crate::models::git::{
    GitConflictContent, GitConflictContentRequest, GitConflictVersion, GitRepositoryActionRequest,
    GitResolveConflictRequest,
};
use crate::services::git_repository_service::validate_relative_path;
use crate::services::process_command_service::hidden_command;

pub fn load_conflict_content(
    root: &Path,
    request: &GitConflictContentRequest,
) -> Result<GitConflictContent, String> {
    validate_relative_path(&request.relative_path)?;
    ensure_unmerged(root, &request.relative_path)?;
    let base = load_index_version(root, 1, &request.relative_path)?;
    let current = load_index_version(root, 2, &request.relative_path)?;
    let incoming = load_index_version(root, 3, &request.relative_path)?;
    let result_bytes = read_worktree_file(root, &request.relative_path)?;
    let result_binary = result_bytes.as_deref().is_some_and(is_binary);
    let binary = base.binary || current.binary || incoming.binary || result_binary;
    let result = if binary {
        None
    } else {
        result_bytes.map(|bytes| String::from_utf8(bytes).unwrap_or_default())
    };
    Ok(GitConflictContent {
        relative_path: request.relative_path.clone(),
        base,
        current,
        incoming,
        result,
        binary,
    })
}

pub fn resolve_conflict(
    root: &Path,
    request: &GitResolveConflictRequest,
) -> Result<String, String> {
    validate_relative_path(&request.relative_path)?;
    ensure_unmerged(root, &request.relative_path)?;
    let resolution = match request.resolution.as_str() {
        "content" => Some(
            request
                .content
                .as_deref()
                .ok_or_else(|| "Resolved content is required".to_string())?
                .as_bytes()
                .to_vec(),
        ),
        "current" => load_index_bytes(root, 2, &request.relative_path)?,
        "incoming" => load_index_bytes(root, 3, &request.relative_path)?,
        "delete" => None,
        _ => return Err("Unsupported conflict resolution".to_string()),
    };
    write_resolution(root, &request.relative_path, resolution.as_deref())?;
    run_git(root, &["add", "-A", "--", request.relative_path.as_str()])?;
    Ok(format!("Resolved {}", request.relative_path))
}

pub fn run_repository_action(
    root: &Path,
    request: &GitRepositoryActionRequest,
) -> Result<String, String> {
    let operation = detect_operation(root)?;
    if operation == "idle" {
        return Err("No Git operation is in progress".to_string());
    }
    let action = match request.action.as_str() {
        "continue" => "--continue",
        "abort" => "--abort",
        _ => return Err("Unsupported Git repository action".to_string()),
    };
    let command = match operation.as_str() {
        "merge" => "merge",
        "rebase" => "rebase",
        "cherryPick" => "cherry-pick",
        "revert" => "revert",
        _ => return Err("Unsupported Git operation".to_string()),
    };
    run_git_with_editor(root, &[command, action])?;
    let outcome = if request.action == "continue" {
        "continued"
    } else {
        "aborted"
    };
    Ok(format!("{} {outcome}", operation_label(&operation)))
}

fn ensure_unmerged(root: &Path, path: &str) -> Result<(), String> {
    let output = run_git_bytes(root, &["ls-files", "-u", "-z", "--", path])?;
    if output.is_empty() {
        Err(format!("{path} is no longer conflicted"))
    } else {
        Ok(())
    }
}

fn load_index_version(root: &Path, stage: u8, path: &str) -> Result<GitConflictVersion, String> {
    let bytes = load_index_bytes(root, stage, path)?;
    let binary = bytes.as_deref().is_some_and(is_binary);
    let content = if binary {
        None
    } else {
        bytes
            .as_ref()
            .map(|value| String::from_utf8(value.clone()).unwrap_or_default())
    };
    Ok(GitConflictVersion {
        exists: bytes.is_some(),
        binary,
        content,
    })
}

fn load_index_bytes(root: &Path, stage: u8, path: &str) -> Result<Option<Vec<u8>>, String> {
    let object = format!(":{stage}:{path}");
    let output = hidden_command("git")
        .args(["show", object.as_str()])
        .current_dir(root)
        .output()
        .map_err(command_launch_error)?;
    if output.status.success() {
        Ok(Some(output.stdout))
    } else {
        Ok(None)
    }
}

fn read_worktree_file(root: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::read(root.join(path)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_resolution(root: &Path, path: &str, content: Option<&[u8]>) -> Result<(), String> {
    let target = root.join(path);
    match content {
        Some(bytes) => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(target, bytes).map_err(|error| error.to_string())
        }
        None => match fs::remove_file(target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

fn detect_operation(root: &Path) -> Result<String, String> {
    let git_dir_output = run_git(root, &["rev-parse", "--git-dir"])?;
    let candidate = PathBuf::from(git_dir_output.trim());
    let git_dir = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    Ok(if git_dir.join("MERGE_HEAD").exists() {
        "merge"
    } else if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        "rebase"
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        "cherryPick"
    } else if git_dir.join("REVERT_HEAD").exists() {
        "revert"
    } else {
        "idle"
    }
    .to_string())
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

fn operation_label(operation: &str) -> &str {
    match operation {
        "cherryPick" => "Cherry-pick",
        "merge" => "Merge",
        "rebase" => "Rebase",
        "revert" => "Revert",
        _ => "Git operation",
    }
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    command_result(
        hidden_command("git")
            .args(args)
            .current_dir(root)
            .output()
            .map_err(command_launch_error)?,
    )
}

fn run_git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = hidden_command("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(command_launch_error)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(command_error(&output))
    }
}

fn run_git_with_editor(root: &Path, args: &[&str]) -> Result<String, String> {
    command_result(
        hidden_command("git")
            .args(args)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .current_dir(root)
            .output()
            .map_err(command_launch_error)?,
    )
}

fn command_result(output: std::process::Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(command_error(&output))
    }
}

fn command_error(output: &std::process::Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        "Git command failed".to_string()
    } else {
        message
    }
}

fn command_launch_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "Git executable is unavailable".to_string()
    } else {
        error.to_string()
    }
}

#[cfg(test)]
#[path = "git_conflict_service_tests.rs"]
mod integration_tests;
