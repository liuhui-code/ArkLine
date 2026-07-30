use std::path::Path;

use crate::models::git::{
    GitDiffResult, GitStashActionRequest, GitStashCreateRequest, GitStashDiffRequest,
    GitStashEntry, GitStashListRequest, GitStashPage,
};
use crate::services::git_query_service::GitQueryRuntime;
use crate::services::git_repository_service::run_git;

const FIELD_SEPARATOR: char = '\u{1f}';
const RECORD_SEPARATOR: char = '\u{1e}';

pub fn list_stashes(root: &Path, request: &GitStashListRequest) -> Result<GitStashPage, String> {
    let output = run_git(
        root,
        &["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%ct%x1e"],
    )?;
    let entries = parse_stash_list(&output)?;
    let total = entries.len();
    let offset = request.cursor.unwrap_or(0) as usize;
    let limit = request.limit.clamp(1, 200) as usize;
    let page = entries
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let consumed = offset.saturating_add(page.len());
    Ok(GitStashPage {
        entries: page,
        total,
        next_cursor: (consumed < total).then_some(consumed as u32),
        has_more: consumed < total,
    })
}

pub fn create_stash(root: &Path, request: &GitStashCreateRequest) -> Result<String, String> {
    let message = request.message.trim();
    if message.len() > 500 {
        return Err("Stash message must be 500 characters or fewer".to_string());
    }
    let mut args = vec!["stash", "push"];
    if request.include_untracked {
        args.push("--include-untracked");
    }
    if request.keep_index {
        args.push("--keep-index");
    }
    if !message.is_empty() {
        args.extend(["-m", message]);
    }
    let output = run_git(root, &args)?;
    if output.contains("No local changes to save") {
        return Err("There are no local changes to stash".to_string());
    }
    Ok(if message.is_empty() {
        "Stashed local changes".to_string()
    } else {
        format!("Stashed local changes: {message}")
    })
}

pub fn run_stash_action(root: &Path, request: &GitStashActionRequest) -> Result<String, String> {
    verify_stash_identity(root, &request.reference, &request.expected_commit)?;
    let label = match request.action.as_str() {
        "apply" => "Applied",
        "pop" => "Popped",
        "drop" => "Dropped",
        _ => return Err("Unsupported stash action".to_string()),
    };
    let mut args = vec!["stash", request.action.as_str()];
    if request.restore_index && request.action != "drop" {
        args.push("--index");
    }
    args.push(request.reference.as_str());
    run_git(root, &args)?;
    Ok(format!("{label} {}", request.reference))
}

pub fn load_stash_diff(
    runtime: &GitQueryRuntime,
    root: &Path,
    request: &GitStashDiffRequest,
) -> Result<GitDiffResult, String> {
    verify_stash_identity(root, &request.reference, &request.expected_commit)?;
    let limit = request.max_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
    let output = runtime.run(
        &request.request_id,
        root,
        &[
            "stash",
            "show",
            "--patch",
            "--include-untracked",
            "--no-ext-diff",
            request.reference.as_str(),
        ],
        request.timeout_ms,
        limit,
    )?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Unable to load stash diff".to_string()
        } else {
            message
        });
    }
    Ok(GitDiffResult {
        content: String::from_utf8_lossy(&output.stdout).to_string(),
        truncated: output.stdout_truncated,
        total_bytes: output.stdout_total_bytes,
    })
}

pub fn parse_stash_list(output: &str) -> Result<Vec<GitStashEntry>, String> {
    output
        .split(RECORD_SEPARATOR)
        .filter_map(|record| {
            let trimmed = record.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .map(|record| {
            let fields = record.split(FIELD_SEPARATOR).collect::<Vec<_>>();
            if fields.len() != 4 {
                return Err("Git returned an invalid stash record".to_string());
            }
            let reference = fields[0].to_string();
            Ok(GitStashEntry {
                index: parse_stash_index(&reference)?,
                reference,
                commit: fields[1].to_string(),
                subject: fields[2].to_string(),
                created_at_epoch_seconds: fields[3]
                    .parse()
                    .map_err(|_| "Git returned an invalid stash timestamp".to_string())?,
            })
        })
        .collect()
}

fn validate_stash_reference(reference: &str) -> Result<(), String> {
    parse_stash_index(reference).map(|_| ())
}

fn verify_stash_identity(
    root: &Path,
    reference: &str,
    expected_commit: &str,
) -> Result<(), String> {
    validate_stash_reference(reference)?;
    validate_commit_hash(expected_commit)?;
    let current_commit = run_git(root, &["rev-parse", "--verify", reference])?;
    if current_commit.trim() == expected_commit {
        Ok(())
    } else {
        Err("The stash list changed. Refresh before running this action".to_string())
    }
}

fn parse_stash_index(reference: &str) -> Result<u32, String> {
    reference
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'))
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "Git stash reference is invalid".to_string())
}

fn validate_commit_hash(commit: &str) -> Result<(), String> {
    if matches!(commit.len(), 40 | 64) && commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Git stash commit is invalid".to_string())
    }
}

#[cfg(test)]
#[path = "git_stash_service_tests.rs"]
mod tests;
