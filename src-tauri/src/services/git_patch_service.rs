use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use crate::models::git::{GitPatchRequest, GitRestorePatchRequest};
use crate::services::git_discard_service::backup_paths;
use crate::services::process_command_service::hidden_command;

const MAX_PATCH_BYTES: usize = 2 * 1024 * 1024;

pub fn apply_patch(root: &Path, request: &GitPatchRequest) -> Result<Option<String>, String> {
    let patch = validated_file_patch(&request.relative_path, &request.patch)?;
    match request.action.as_str() {
        "stage" => {
            run_apply(root, &patch, true, false)?;
            Ok(None)
        }
        "unstage" => {
            run_apply(root, &patch, true, false)?;
            Ok(None)
        }
        "discard" => {
            let backup = backup_paths(root, std::slice::from_ref(&request.relative_path))?;
            run_apply(root, &patch, false, false)?;
            Ok(Some(backup))
        }
        _ => Err("Unsupported Git patch action".to_string()),
    }
}

pub fn restore_patch(root: &Path, request: &GitRestorePatchRequest) -> Result<(), String> {
    validate_commit(&request.backup_commit)?;
    let patch = validated_file_patch(&request.relative_path, &request.patch)?;
    run_apply(root, &patch, false, true)
}

fn validated_file_patch(path: &str, body: &str) -> Result<String, String> {
    if path.bytes().any(|value| value < b' ' || value == 0x7f) {
        return Err("Partial Git actions do not support control characters in paths".to_string());
    }
    validate_patch_body(body)?;
    Ok(format!("--- a/{path}\n+++ b/{path}\n{body}"))
}

fn validate_patch_body(body: &str) -> Result<(), String> {
    if body.is_empty() || body.len() > MAX_PATCH_BYTES {
        return Err(format!(
            "Git patch must be between 1 and {MAX_PATCH_BYTES} bytes"
        ));
    }
    let mut hunk_seen = false;
    let mut changed = false;
    let mut expected = None;
    let mut old_count = 0usize;
    let mut new_count = 0usize;
    for line in body.lines() {
        if line.starts_with("@@") {
            verify_counts(expected.take(), old_count, new_count)?;
            expected = Some(parse_hunk_counts(line)?);
            old_count = 0;
            new_count = 0;
            hunk_seen = true;
            continue;
        }
        if expected.is_none() {
            return Err("Git patch content must start with a hunk header".to_string());
        }
        match line.as_bytes().first().copied() {
            Some(b'+') => {
                new_count += 1;
                changed = true;
            }
            Some(b'-') => {
                old_count += 1;
                changed = true;
            }
            Some(b' ') => {
                old_count += 1;
                new_count += 1;
            }
            Some(b'\\') => {}
            _ => return Err("Git patch contains an unsupported line".to_string()),
        }
    }
    verify_counts(expected, old_count, new_count)?;
    if !hunk_seen || !changed {
        return Err("Git patch must contain at least one changed line".to_string());
    }
    Ok(())
}

fn parse_hunk_counts(header: &str) -> Result<(usize, usize), String> {
    let ranges = header
        .strip_prefix("@@ -")
        .and_then(|value| value.split_once(" +"))
        .and_then(|(old, rest)| rest.split_once(" @@").map(|(new, _)| (old, new)))
        .ok_or_else(|| "Git patch has an invalid hunk header".to_string())?;
    Ok((range_count(ranges.0)?, range_count(ranges.1)?))
}

fn range_count(range: &str) -> Result<usize, String> {
    let (start, count) = range.split_once(',').unwrap_or((range, "1"));
    start
        .parse::<usize>()
        .and_then(|_| count.parse::<usize>())
        .map_err(|_| "Git patch has an invalid range".to_string())
}

fn verify_counts(
    expected: Option<(usize, usize)>,
    old_count: usize,
    new_count: usize,
) -> Result<(), String> {
    if let Some(expected) = expected {
        if expected != (old_count, new_count) {
            return Err("Git patch hunk line counts do not match its header".to_string());
        }
    }
    Ok(())
}

fn run_apply(root: &Path, patch: &str, cached: bool, reverse: bool) -> Result<(), String> {
    execute_apply(root, patch, cached, reverse, true)?;
    execute_apply(root, patch, cached, reverse, false)
}

fn execute_apply(
    root: &Path,
    patch: &str,
    cached: bool,
    reverse: bool,
    check: bool,
) -> Result<(), String> {
    let mut command = hidden_command("git");
    command.args(["apply", "--unidiff-zero", "--whitespace=nowarn"]);
    if check {
        command.arg("--check");
    }
    if cached {
        command.arg("--cached");
    }
    if reverse {
        command.arg("--reverse");
    }
    let mut child = command
        .arg("-")
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Git patch input is unavailable".to_string())?
        .write_all(patch.as_bytes())
        .map_err(|error| error.to_string())?;
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            "Git patch could not be applied".to_string()
        } else {
            message
        })
    }
}

fn validate_commit(commit: &str) -> Result<(), String> {
    if (40..=64).contains(&commit.len()) && commit.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Discard backup identifier is invalid".to_string())
    }
}

#[cfg(test)]
#[path = "git_patch_service_tests.rs"]
mod tests;
