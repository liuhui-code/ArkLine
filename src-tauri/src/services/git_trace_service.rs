use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::language::{
    GitBlameLine, GitBlameResponse, GitCommitTrace, GitCommitTraceResponse, GitTraceUnavailable,
};

pub fn load_file_blame(path: &Path) -> Result<GitBlameResponse, String> {
    let repo_root = match resolve_repo_root(path)? {
        Some(root) => root,
        None => {
            return Ok(GitBlameResponse::Unavailable(GitTraceUnavailable {
                kind: "unavailable".to_string(),
                reason: "notRepository".to_string(),
                message: "Not a Git-tracked file".to_string(),
            }))
        }
    };

    if !is_tracked_file(&repo_root, path)? {
        return Ok(GitBlameResponse::Unavailable(GitTraceUnavailable {
            kind: "unavailable".to_string(),
            reason: "notTracked".to_string(),
            message: "File is not tracked by Git".to_string(),
        }));
    }

    let output = run_git(
        &repo_root,
        ["blame", "--line-porcelain", "--", &path.to_string_lossy()],
    )?;
    let lines = parse_blame_porcelain(&output)?;
    Ok(GitBlameResponse::Lines(lines))
}

pub fn load_commit_trace(
    path: &Path,
    commit: &str,
    line: usize,
) -> Result<GitCommitTraceResponse, String> {
    let repo_root = match resolve_repo_root(path)? {
        Some(root) => root,
        None => {
            return Ok(GitCommitTraceResponse::Unavailable(GitTraceUnavailable {
                kind: "unavailable".to_string(),
                reason: "notRepository".to_string(),
                message: "Not a Git-tracked file".to_string(),
            }))
        }
    };

    if !is_tracked_file(&repo_root, path)? {
        return Ok(GitCommitTraceResponse::Unavailable(GitTraceUnavailable {
            kind: "unavailable".to_string(),
            reason: "notTracked".to_string(),
            message: "File is not tracked by Git".to_string(),
        }));
    }

    let relative_path = path
        .strip_prefix(&repo_root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"));
    let output = run_git(&repo_root, ["show", commit, "--", &relative_path])?;
    let trace = parse_commit_show(&output, &relative_path, commit, line, line)?;
    Ok(GitCommitTraceResponse::Trace(trace))
}

fn resolve_repo_root(path: &Path) -> Result<Option<PathBuf>, String> {
    let working_dir = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };

    match run_git(working_dir, ["rev-parse", "--show-toplevel"]) {
        Ok(output) => Ok(Some(PathBuf::from(output.trim()))),
        Err(error) if error.contains("not a git repository") => Ok(None),
        Err(error) => Err(error),
    }
}

fn is_tracked_file(repo_root: &Path, path: &Path) -> Result<bool, String> {
    let relative_path = path
        .strip_prefix(repo_root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"));

    match run_git(
        repo_root,
        ["ls-files", "--error-unmatch", "--", &relative_path],
    ) {
        Ok(_) => Ok(true),
        Err(error) if error.contains("did not match any file") => Ok(false),
        Err(error) => Err(error),
    }
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Git unavailable".to_string()
            } else {
                error.to_string()
            }
        })?;

    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|error| error.to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("Git command failed".to_string())
    } else {
        Err(stderr)
    }
}

pub fn parse_blame_porcelain(input: &str) -> Result<Vec<GitBlameLine>, String> {
    let mut lines = Vec::new();
    let mut current_commit = String::new();
    let mut current_source_line = 0usize;
    let mut current_author = String::new();
    let mut current_authored_at = String::new();
    let mut current_summary = String::new();

    for raw_line in input.lines() {
        if raw_line.is_empty() {
            continue;
        }

        if let Some(content) = raw_line.strip_prefix('\t') {
            lines.push(GitBlameLine {
                line: lines.len() + 1,
                commit: current_commit.clone(),
                source_line: current_source_line,
                author: current_author.clone(),
                authored_at: current_authored_at.clone(),
                relative_time: current_authored_at.clone(),
                summary: if current_summary.is_empty() {
                    content.trim().to_string()
                } else {
                    current_summary.clone()
                },
            });
            continue;
        }

        if let Some((header, _)) = raw_line.split_once(' ') {
            if header.len() >= 7 && header.chars().all(|char| char.is_ascii_hexdigit()) {
                let parts: Vec<&str> = raw_line.split_whitespace().collect();
                current_commit = parts.first().unwrap_or(&"").to_string();
                current_source_line = parts
                    .get(1)
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                current_author.clear();
                current_authored_at.clear();
                current_summary.clear();
                continue;
            }
        }

        if let Some(value) = raw_line.strip_prefix("author ") {
            current_author = value.to_string();
            continue;
        }

        if let Some(value) = raw_line.strip_prefix("author-time ") {
            current_authored_at = value.to_string();
            continue;
        }

        if let Some(value) = raw_line.strip_prefix("summary ") {
            current_summary = value.to_string();
        }
    }

    Ok(lines)
}

pub fn parse_commit_show(
    input: &str,
    relative_path: &str,
    commit: &str,
    selected_line: usize,
    source_line: usize,
) -> Result<GitCommitTrace, String> {
    let mut author = String::new();
    let mut email = None;
    let mut authored_at = String::new();
    let mut subject = String::new();
    let mut patch_lines = Vec::new();
    let mut in_subject = false;
    let mut in_patch = false;

    for raw_line in input.lines() {
        if let Some(value) = raw_line.strip_prefix("Author: ") {
            if let Some((name, rest)) = value.rsplit_once(" <") {
                author = name.to_string();
                email = Some(rest.trim_end_matches('>').to_string());
            } else {
                author = value.to_string();
            }
            continue;
        }

        if let Some(value) = raw_line.strip_prefix("Date:") {
            authored_at = value.trim().to_string();
            in_subject = true;
            continue;
        }

        if raw_line.starts_with("diff --git ") {
            in_patch = true;
            in_subject = false;
        }

        if in_patch {
            patch_lines.push(raw_line.to_string());
            continue;
        }

        if in_subject {
            if raw_line.trim().is_empty() {
                continue;
            }

            if subject.is_empty() {
                subject = raw_line.trim().to_string();
            }
        }
    }

    Ok(GitCommitTrace {
        commit: commit.to_string(),
        short_commit: commit.chars().take(7).collect(),
        author,
        email,
        authored_at,
        subject,
        relative_path: relative_path.to_string(),
        selected_line,
        source_line,
        patch: patch_lines.join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_blame_porcelain, parse_commit_show, GitBlameLine, GitCommitTrace};

    #[test]
    fn parses_git_blame_porcelain_into_line_entries() {
        let fixture = "\
abc1234 3 3 1
author Jane Doe
author-mail <jane@example.com>
author-time 1719120000
summary Add ArkLine label
\tText(\"ArkLine\")
";

        let lines = parse_blame_porcelain(fixture).expect("fixture should parse");
        assert_eq!(
            lines,
            vec![GitBlameLine {
                line: 1,
                commit: "abc1234".to_string(),
                source_line: 3,
                author: "Jane Doe".to_string(),
                authored_at: "1719120000".to_string(),
                relative_time: "1719120000".to_string(),
                summary: "Add ArkLine label".to_string(),
            }]
        );
    }

    #[test]
    fn parses_commit_show_output_into_trace_details() {
        let fixture = "\
commit abc1234567890
Author: Jane Doe <jane@example.com>
Date:   Sun Jun 23 01:20:00 2024 +0000

    Add ArkLine label

diff --git a/src/main.ets b/src/main.ets
index 1111111..2222222 100644
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,2 +1,3 @@
 @Entry
+Text(\"ArkLine\")
 @Component
";

        let trace = parse_commit_show(fixture, "src/main.ets", "abc1234567890", 3, 3)
            .expect("fixture should parse");

        assert_eq!(
            trace,
            GitCommitTrace {
                commit: "abc1234567890".to_string(),
                short_commit: "abc1234".to_string(),
                author: "Jane Doe".to_string(),
                email: Some("jane@example.com".to_string()),
                authored_at: "Sun Jun 23 01:20:00 2024 +0000".to_string(),
                subject: "Add ArkLine label".to_string(),
                relative_path: "src/main.ets".to_string(),
                selected_line: 3,
                source_line: 3,
                patch: "diff --git a/src/main.ets b/src/main.ets\nindex 1111111..2222222 100644\n--- a/src/main.ets\n+++ b/src/main.ets\n@@ -1,2 +1,3 @@\n @Entry\n+Text(\"ArkLine\")\n @Component".to_string(),
            }
        );
    }
}
