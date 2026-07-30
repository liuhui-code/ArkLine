use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::models::git::{GitChangeEntry, GitRepositorySnapshot, GitRepositorySnapshotRequest};
use crate::services::git_query_service::{GitQueryOutput, GitQueryRuntime};
use crate::services::process_command_service::hidden_command;

pub const DEFAULT_CHANGE_PAGE_SIZE: u32 = 200;
const MAX_CHANGE_PAGE_SIZE: u32 = 500;
const STATUS_OUTPUT_LIMIT: usize = 32 * 1024 * 1024;

pub fn default_snapshot_request(
    root_path: &str,
    request_id: String,
) -> GitRepositorySnapshotRequest {
    GitRepositorySnapshotRequest {
        root_path: root_path.to_string(),
        cursor: None,
        limit: DEFAULT_CHANGE_PAGE_SIZE,
        request_id,
        timeout_ms: 15_000,
    }
}

pub fn read_snapshot(
    runtime: &GitQueryRuntime,
    request: &GitRepositorySnapshotRequest,
    generation: u64,
) -> Result<GitRepositorySnapshot, String> {
    let root = resolve_repo_root(Path::new(&request.root_path))?;
    let output = runtime.run(
        &request.request_id,
        &root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=normal",
        ],
        request.timeout_ms,
        STATUS_OUTPUT_LIMIT,
    )?;
    ensure_success(&output)?;
    if output.stdout_truncated {
        return Err(format!(
            "Git status exceeded the {} MiB safety limit. Add generated directories to .gitignore and retry.",
            STATUS_OUTPUT_LIMIT / 1024 / 1024
        ));
    }
    parse_status_page(&root, request, &output.stdout, generation)
}

pub fn parse_status_page(
    root: &Path,
    request: &GitRepositorySnapshotRequest,
    output: &[u8],
    generation: u64,
) -> Result<GitRepositorySnapshot, String> {
    let offset = parse_cursor(request.cursor.as_deref())?;
    let limit = request.limit.clamp(1, MAX_CHANGE_PAGE_SIZE) as usize;
    let records = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut current_branch = None;
    let mut detached = false;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::with_capacity(limit);
    let mut total_changes = 0;
    let mut staged_changes = 0;
    let mut conflicted_changes = 0;
    let mut index = 0;
    while index < records.len() {
        let record = String::from_utf8_lossy(records[index]);
        index += 1;
        if record.is_empty() {
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.head ") {
            detached = value == "(detached)";
            current_branch = (!detached && value != "(initial)").then(|| value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.ab ") {
            (ahead, behind) = parse_ahead_behind(value);
            continue;
        }
        let entry = if record.starts_with("1 ") {
            Some(parse_ordinary_entry(root, &record)?)
        } else if record.starts_with("2 ") {
            let original = records
                .get(index)
                .map(|value| String::from_utf8_lossy(value).to_string());
            index += usize::from(original.is_some());
            Some(parse_renamed_entry(root, &record, original)?)
        } else if record.starts_with("u ") {
            Some(parse_unmerged_entry(root, &record)?)
        } else {
            record
                .strip_prefix("? ")
                .map(|path| make_entry(root, path, None, "??", "untracked", false, true, false))
        };
        if let Some(entry) = entry {
            staged_changes += usize::from(entry.staged && !entry.conflicted);
            conflicted_changes += usize::from(entry.conflicted);
            if total_changes >= offset && changes.len() < limit {
                changes.push(entry);
            }
            total_changes += 1;
        }
    }
    let consumed = offset.saturating_add(changes.len());
    let has_more = consumed < total_changes;
    Ok(GitRepositorySnapshot {
        root_path: request.root_path.clone(),
        repository_root: root.to_string_lossy().to_string(),
        current_branch,
        detached,
        upstream,
        ahead,
        behind,
        operation: detect_operation(root),
        generation,
        snapshot_id: snapshot_id(output),
        total_changes,
        staged_changes,
        conflicted_changes,
        next_cursor: has_more.then(|| consumed.to_string()),
        has_more,
        changes,
    })
}

fn parse_ordinary_entry(root: &Path, record: &str) -> Result<GitChangeEntry, String> {
    let fields = record.splitn(9, ' ').collect::<Vec<_>>();
    parse_tracked_entry(root, fields.get(1), fields.get(8), None, false)
}

fn parse_renamed_entry(
    root: &Path,
    record: &str,
    original: Option<String>,
) -> Result<GitChangeEntry, String> {
    let fields = record.splitn(10, ' ').collect::<Vec<_>>();
    parse_tracked_entry(root, fields.get(1), fields.get(9), original, false)
}

fn parse_unmerged_entry(root: &Path, record: &str) -> Result<GitChangeEntry, String> {
    let fields = record.splitn(11, ' ').collect::<Vec<_>>();
    parse_tracked_entry(root, fields.get(1), fields.get(10), None, true)
}

fn parse_tracked_entry(
    root: &Path,
    status: Option<&&str>,
    path: Option<&&str>,
    original: Option<String>,
    conflicted: bool,
) -> Result<GitChangeEntry, String> {
    let status = status.copied().unwrap_or_default();
    let path = path.copied().unwrap_or_default();
    if status.len() != 2 || path.is_empty() {
        return Err("Git returned an invalid status record".to_string());
    }
    let bytes = status.as_bytes();
    Ok(make_entry(
        root,
        path,
        original,
        status,
        change_kind(bytes[0], bytes[1], conflicted),
        bytes[0] != b'.',
        bytes[1] != b'.',
        conflicted,
    ))
}

fn make_entry(
    root: &Path,
    path: &str,
    original: Option<String>,
    status: &str,
    kind: &str,
    staged: bool,
    unstaged: bool,
    conflicted: bool,
) -> GitChangeEntry {
    GitChangeEntry {
        relative_path: path.to_string(),
        absolute_path: root.join(path).to_string_lossy().to_string(),
        original_path: original,
        status_code: status.to_string(),
        kind: kind.to_string(),
        staged,
        unstaged,
        conflicted,
    }
}

fn change_kind(index: u8, worktree: u8, conflicted: bool) -> &'static str {
    if conflicted {
        "conflicted"
    } else if index == b'R' || worktree == b'R' {
        "renamed"
    } else if index == b'A' || worktree == b'A' {
        "added"
    } else if index == b'D' || worktree == b'D' {
        "deleted"
    } else {
        "modified"
    }
}

pub(crate) fn parse_ahead_behind(value: &str) -> (u32, u32) {
    let mut parts = value.split_whitespace();
    let ahead = parse_divergence(parts.next(), '+');
    let behind = parse_divergence(parts.next(), '-');
    (ahead, behind)
}

fn parse_divergence(value: Option<&str>, prefix: char) -> u32 {
    value
        .and_then(|part| part.strip_prefix(prefix))
        .and_then(|part| part.parse().ok())
        .unwrap_or(0)
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize, String> {
    match cursor {
        None | Some("") => Ok(0),
        Some(value) => value
            .parse()
            .map_err(|_| "Git change cursor is invalid".to_string()),
    }
}

fn snapshot_id(output: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    output.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn detect_operation(root: &Path) -> String {
    let git_dir = run_git(root, &["rev-parse", "--git-dir"])
        .ok()
        .map(|value| root.join(value.trim()));
    let Some(git_dir) = git_dir else {
        return "idle".to_string();
    };
    if git_dir.join("MERGE_HEAD").exists() {
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
    .to_string()
}

fn resolve_repo_root(path: &Path) -> Result<PathBuf, String> {
    let cwd = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    PathBuf::from(run_git(cwd, &["rev-parse", "--show-toplevel"])?.trim())
        .canonicalize()
        .map_err(|error| error.to_string())
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn ensure_success(output: &GitQueryOutput) -> Result<(), String> {
    if output.status.success() {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            "Git status failed".to_string()
        } else {
            message
        })
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{parse_ahead_behind, parse_status_page};
    use crate::models::git::GitRepositorySnapshotRequest;

    #[test]
    fn status_pages_changes_without_losing_totals() {
        let request = GitRepositorySnapshotRequest {
            root_path: "/repo".into(),
            cursor: Some("1".into()),
            limit: 2,
            request_id: "status-test".into(),
            timeout_ms: 1_000,
        };
        let input = b"# branch.head main\0# branch.ab +2 -1\01 M. N... 100644 100644 100644 aaa bbb staged.ets\0u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ets\0? three.ets\0? four.ets\0";
        let snapshot = parse_status_page(Path::new("/repo"), &request, input, 7).unwrap();
        assert_eq!(snapshot.total_changes, 4);
        assert_eq!(snapshot.staged_changes, 1);
        assert_eq!(snapshot.conflicted_changes, 1);
        assert_eq!(snapshot.changes.len(), 2);
        assert_eq!(snapshot.changes[0].relative_path, "conflict.ets");
        assert_eq!(snapshot.next_cursor.as_deref(), Some("3"));
        assert!(snapshot.has_more);
    }

    #[test]
    fn parses_branch_divergence() {
        assert_eq!(parse_ahead_behind("+12 -3"), (12, 3));
    }
}
