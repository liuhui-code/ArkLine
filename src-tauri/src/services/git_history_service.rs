use std::path::{Path, PathBuf};

use crate::models::git::{
    GitCommitDetails, GitCommitDetailsRequest, GitCommitFile, GitCommitFileDiffRequest,
    GitCommitSummary, GitDiffResult, GitHistoryActionRequest, GitHistoryPage, GitHistoryRequest,
};
use crate::services::git_query_service::{GitQueryOutput, GitQueryRuntime};
use crate::services::git_repository_service::validate_relative_path;
use crate::services::process_command_service::hidden_command;

const FIELD_SEPARATOR: char = '\u{1f}';
const RECORD_SEPARATOR: char = '\u{1e}';
const MAX_PAGE_SIZE: u32 = 100;
const HISTORY_OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
const DETAILS_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;

pub fn load_history(
    runtime: &GitQueryRuntime,
    request: &GitHistoryRequest,
) -> Result<GitHistoryPage, String> {
    let root = resolve_repo_root(
        runtime,
        &request.root_path,
        &request.request_id,
        request.timeout_ms,
    )?;
    let offset = parse_cursor(request.cursor.as_deref())?;
    let limit = request.limit.clamp(1, MAX_PAGE_SIZE) as usize;
    let fetch_count = limit + 1;
    let offset_value = offset.to_string();
    let count_value = fetch_count.to_string();
    let format = format!(
        "--format={RECORD_SEPARATOR}%H{FIELD_SEPARATOR}%h{FIELD_SEPARATOR}%P{FIELD_SEPARATOR}%D{FIELD_SEPARATOR}%an{FIELD_SEPARATOR}%ae{FIELD_SEPARATOR}%at{FIELD_SEPARATOR}%s"
    );
    let revision = request.ref_name.as_deref().unwrap_or("--all");
    if revision.starts_with('-') && revision != "--all" {
        return Err("Invalid Git history reference".to_string());
    }
    let output = match run_git(
        runtime,
        &request.request_id,
        &root,
        &[
            "log",
            "--graph",
            revision,
            "--topo-order",
            "--decorate=full",
            format.as_str(),
            "--skip",
            offset_value.as_str(),
            "-n",
            count_value.as_str(),
        ],
        request.timeout_ms,
        HISTORY_OUTPUT_LIMIT,
        false,
    ) {
        Ok(output) => output,
        Err(error) if is_empty_repository_error(&error) => String::new(),
        Err(error) => return Err(error),
    };
    let mut commits = parse_history(&output)?;
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(GitHistoryPage {
        next_cursor: has_more.then(|| (offset + commits.len()).to_string()),
        has_more,
        commits,
    })
}

pub fn load_commit_details(
    runtime: &GitQueryRuntime,
    request: &GitCommitDetailsRequest,
) -> Result<GitCommitDetails, String> {
    validate_commit(&request.commit)?;
    let root = resolve_repo_root(
        runtime,
        &request.root_path,
        &request.request_id,
        request.timeout_ms,
    )?;
    let metadata_format = format!(
        "--format=%H{FIELD_SEPARATOR}%h{FIELD_SEPARATOR}%P{FIELD_SEPARATOR}%an{FIELD_SEPARATOR}%ae{FIELD_SEPARATOR}%at{FIELD_SEPARATOR}%s{FIELD_SEPARATOR}%B"
    );
    let metadata = run_git(
        runtime,
        &request.request_id,
        &root,
        &[
            "show",
            "-s",
            metadata_format.as_str(),
            request.commit.as_str(),
        ],
        request.timeout_ms,
        1024 * 1024,
        false,
    )?;
    let fields = metadata
        .trim_end()
        .splitn(8, FIELD_SEPARATOR)
        .collect::<Vec<_>>();
    if fields.len() != 8 {
        return Err("Git returned incomplete commit metadata".to_string());
    }
    let files = run_git_output(
        runtime,
        &request.request_id,
        &root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            "-M",
            request.commit.as_str(),
        ],
        request.timeout_ms,
        DETAILS_OUTPUT_LIMIT,
    )?;
    ensure_success(&files, false)?;
    let file_bytes = complete_records(&files.stdout, files.stdout_truncated);
    Ok(GitCommitDetails {
        commit: fields[0].to_string(),
        short_commit: fields[1].to_string(),
        parents: split_words(fields[2]),
        author: fields[3].to_string(),
        author_email: fields[4].to_string(),
        authored_at_epoch_seconds: fields[5].parse().unwrap_or_default(),
        subject: fields[6].to_string(),
        body: fields[7].trim().to_string(),
        files: parse_commit_files(file_bytes, files.stdout_truncated)?,
        files_truncated: files.stdout_truncated,
    })
}

pub fn load_commit_diff(
    runtime: &GitQueryRuntime,
    request: &GitCommitDetailsRequest,
) -> Result<GitDiffResult, String> {
    validate_commit(&request.commit)?;
    let root = resolve_repo_root(
        runtime,
        &request.root_path,
        &request.request_id,
        request.timeout_ms,
    )?;
    let limit = request.max_diff_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
    let output = run_git_output(
        runtime,
        &request.request_id,
        &root,
        &[
            "show",
            "--format=fuller",
            "--stat",
            "--patch",
            "--no-ext-diff",
            request.commit.as_str(),
            "--",
        ],
        request.timeout_ms,
        limit,
    )?;
    ensure_success(&output, false)?;
    Ok(GitDiffResult {
        content: String::from_utf8_lossy(&output.stdout).to_string(),
        truncated: output.stdout_truncated,
        total_bytes: output.stdout_total_bytes,
    })
}

pub fn load_commit_file_diff(
    runtime: &GitQueryRuntime,
    request: &GitCommitFileDiffRequest,
) -> Result<GitDiffResult, String> {
    validate_commit(&request.commit)?;
    validate_relative_path(&request.relative_path)?;
    if let Some(previous_path) = request.previous_path.as_deref() {
        validate_relative_path(previous_path)?;
    }
    let root = resolve_repo_root(
        runtime,
        &request.root_path,
        &request.request_id,
        request.timeout_ms,
    )?;
    let limit = request.max_diff_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
    let mut args = vec![
        "show",
        "--format=",
        "--patch",
        "--find-renames",
        "--no-ext-diff",
        request.commit.as_str(),
        "--",
        request.relative_path.as_str(),
    ];
    if let Some(previous_path) = request.previous_path.as_deref() {
        if previous_path != request.relative_path {
            args.push(previous_path);
        }
    }
    let output = run_git_output(
        runtime,
        &request.request_id,
        &root,
        &args,
        request.timeout_ms,
        limit,
    )?;
    ensure_success(&output, false)?;
    Ok(GitDiffResult {
        content: String::from_utf8_lossy(&output.stdout).to_string(),
        truncated: output.stdout_truncated,
        total_bytes: output.stdout_total_bytes,
    })
}

pub fn run_commit_action(root: &Path, request: &GitHistoryActionRequest) -> Result<String, String> {
    validate_commit(&request.commit)?;
    let action_label = match request.action.as_str() {
        "cherryPick" => "Cherry-picked",
        "revert" => "Reverted",
        _ => return Err("Unsupported Git history action".to_string()),
    };
    let status = run_mutation_git(
        root,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )?;
    if !status.trim().is_empty() {
        return Err("Commit actions require a clean working tree".to_string());
    }
    let object = format!("{}^{{commit}}", request.commit);
    run_mutation_git(root, &["cat-file", "-e", object.as_str()])?;
    let parents = run_mutation_git(
        root,
        &["rev-list", "--parents", "-n", "1", request.commit.as_str()],
    )?;
    if parents.split_whitespace().count() > 2 {
        return Err(
            "Merge commits require an explicit mainline parent and are not supported yet"
                .to_string(),
        );
    }
    let command = if request.action == "cherryPick" {
        "cherry-pick"
    } else {
        "revert"
    };
    run_mutation_git(root, &[command, "--no-edit", request.commit.as_str()])?;
    Ok(format!("{action_label} {}", &request.commit[..7]))
}

pub fn parse_history(output: &str) -> Result<Vec<GitCommitSummary>, String> {
    output
        .lines()
        .filter_map(|line| line.find(RECORD_SEPARATOR).map(|index| (line, index)))
        .map(|(line, index)| {
            let fields = line[index + RECORD_SEPARATOR.len_utf8()..]
                .splitn(8, FIELD_SEPARATOR)
                .collect::<Vec<_>>();
            if fields.len() != 8 {
                return Err("Git returned an incomplete history record".to_string());
            }
            Ok(GitCommitSummary {
                commit: fields[0].to_string(),
                short_commit: fields[1].to_string(),
                parents: split_words(fields[2]),
                refs: normalize_refs(fields[3]),
                author: fields[4].to_string(),
                author_email: fields[5].to_string(),
                authored_at_epoch_seconds: fields[6].parse().unwrap_or_default(),
                subject: fields[7].to_string(),
                graph: line[..index].trim_end().to_string(),
            })
        })
        .collect()
}

fn parse_commit_files(
    output: &[u8],
    allow_incomplete_tail: bool,
) -> Result<Vec<GitCommitFile>, String> {
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .map(|field| String::from_utf8_lossy(field).to_string())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = fields[index].clone();
        index += 1;
        if status.starts_with('R') || status.starts_with('C') {
            if fields.len().saturating_sub(index) < 2 && allow_incomplete_tail {
                break;
            }
            let previous_path = fields.get(index).cloned();
            let path = fields.get(index + 1).cloned();
            index += 2;
            files.push(GitCommitFile {
                status,
                path: path.ok_or_else(|| "Git returned an incomplete renamed path".to_string())?,
                previous_path,
            });
        } else {
            if fields.get(index).is_none() && allow_incomplete_tail {
                break;
            }
            let path = fields
                .get(index)
                .cloned()
                .ok_or_else(|| "Git returned an incomplete changed path".to_string())?;
            index += 1;
            files.push(GitCommitFile {
                status,
                path,
                previous_path: None,
            });
        }
    }
    Ok(files)
}

fn normalize_refs(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .replace("refs/heads/", "")
                .replace("refs/remotes/", "")
                .replace("refs/tags/", "")
        })
        .collect()
}

fn split_words(value: &str) -> Vec<String> {
    value.split_whitespace().map(str::to_string).collect()
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize, String> {
    match cursor {
        None | Some("") => Ok(0),
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| "Git history cursor is invalid".to_string()),
    }
}

fn validate_commit(commit: &str) -> Result<(), String> {
    if (7..=64).contains(&commit.len()) && commit.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Git commit identifier is invalid".to_string())
    }
}

fn resolve_repo_root(
    runtime: &GitQueryRuntime,
    root_path: &str,
    request_id: &str,
    timeout_ms: u64,
) -> Result<PathBuf, String> {
    let requested = Path::new(root_path);
    let output = run_git(
        runtime,
        request_id,
        requested,
        &["rev-parse", "--show-toplevel"],
        timeout_ms,
        4 * 1024,
        false,
    )?;
    let root = output.trim();
    if root.is_empty() {
        Err("Git repository root is unavailable".to_string())
    } else {
        Ok(PathBuf::from(root))
    }
}

fn run_git(
    runtime: &GitQueryRuntime,
    request_id: &str,
    root: &Path,
    args: &[&str],
    timeout_ms: u64,
    limit: usize,
    allow_diff: bool,
) -> Result<String, String> {
    let output = run_git_output(runtime, request_id, root, args, timeout_ms, limit)?;
    ensure_success(&output, allow_diff)?;
    if output.stdout_truncated {
        return Err("Git query exceeded its output safety limit".to_string());
    }
    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

fn run_git_output(
    runtime: &GitQueryRuntime,
    request_id: &str,
    root: &Path,
    args: &[&str],
    timeout_ms: u64,
    limit: usize,
) -> Result<GitQueryOutput, String> {
    runtime.run(request_id, root, args, timeout_ms, limit)
}

fn ensure_success(output: &GitQueryOutput, allow_diff: bool) -> Result<(), String> {
    if output.status.success() || (allow_diff && output.status.code() == Some(1)) {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if error.is_empty() {
        "Git command failed".to_string()
    } else {
        error
    })
}

fn run_mutation_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
        .args(args)
        .env("GIT_EDITOR", "true")
        .current_dir(root)
        .output()
        .map_err(|error| format!("Failed to start Git: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if error.is_empty() {
            "Git command failed".to_string()
        } else {
            error
        })
    }
}

fn complete_records(output: &[u8], truncated: bool) -> &[u8] {
    if !truncated {
        return output;
    }
    output
        .iter()
        .rposition(|byte| *byte == 0)
        .map(|index| &output[..=index])
        .unwrap_or_default()
}

fn is_empty_repository_error(error: &str) -> bool {
    error.contains("does not have any commits yet") || error.contains("bad default revision")
}

#[cfg(test)]
mod tests {
    use super::{parse_commit_files, parse_history};

    #[test]
    fn parses_graph_history_and_changed_files() {
        let history = "* \u{1e}abc123456789\u{1f}abc1234\u{1f}parent1 parent2\u{1f}HEAD -> refs/heads/main, tag: refs/tags/v1\u{1f}Jane\u{1f}jane@example.com\u{1f}1700000000\u{1f}Merge feature";
        let commits = parse_history(history).expect("history should parse");
        assert_eq!(commits[0].graph, "*");
        assert_eq!(commits[0].parents, vec!["parent1", "parent2"]);
        assert_eq!(commits[0].refs, vec!["HEAD -> main", "tag: v1"]);

        let files = parse_commit_files(b"M\0src/main.ets\0R100\0old.ets\0new.ets\0", false)
            .expect("files should parse");
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].previous_path.as_deref(), Some("old.ets"));
        assert_eq!(files[1].path, "new.ets");
    }
}

#[cfg(test)]
#[path = "git_history_service_tests.rs"]
mod integration_tests;
