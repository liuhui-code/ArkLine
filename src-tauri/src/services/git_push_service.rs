use std::path::{Path, PathBuf};

use crate::models::git::{GitHistoryRequest, GitPushPreview, GitPushPreviewRequest};
use crate::services::git_history_service;
use crate::services::git_query_service::GitQueryRuntime;
use crate::services::process_command_service::hidden_command;

pub fn preview_push(
    runtime: &GitQueryRuntime,
    request: &GitPushPreviewRequest,
) -> Result<GitPushPreview, String> {
    let root = repository_root(Path::new(&request.root_path))?;
    let local_branch = git_text(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok_or_else(|| "Push requires a checked-out local branch".to_string())?;
    let upstream = git_text(
        &root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    );
    let (remote, remote_branch, has_upstream, range) = match upstream {
        Some(value) => {
            let (remote, branch) = value
                .split_once('/')
                .ok_or_else(|| "Git returned an invalid upstream branch".to_string())?;
            (
                remote.to_string(),
                branch.to_string(),
                true,
                format!("{value}..HEAD"),
            )
        }
        None => {
            let remote = default_remote(&root).unwrap_or_else(|| "origin".to_string());
            (remote, local_branch.clone(), false, "HEAD".to_string())
        }
    };
    let total_commits = git_text(&root, &["rev-list", "--count", &range])
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| "Unable to count outgoing commits".to_string())?;
    let commits = git_history_service::load_history(
        runtime,
        &GitHistoryRequest {
            root_path: root.to_string_lossy().into_owned(),
            ref_name: Some(range),
            cursor: None,
            limit: 100,
            request_id: request.request_id.clone(),
            timeout_ms: request.timeout_ms,
        },
    )?
    .commits;
    Ok(GitPushPreview {
        root_path: request.root_path.clone(),
        repository_root: root.to_string_lossy().into_owned(),
        local_branch,
        remote,
        remote_branch,
        has_upstream,
        total_commits,
        commits_truncated: commits.len() < total_commits,
        commits,
    })
}

fn repository_root(root: &Path) -> Result<PathBuf, String> {
    git_text(root, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .ok_or_else(|| "The workspace is not inside a Git repository".to_string())
}

fn default_remote(root: &Path) -> Option<String> {
    let remotes = git_text(root, &["remote"])?;
    let names = remotes
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    names
        .iter()
        .find(|name| **name == "origin")
        .or(names.first())
        .map(|name| (*name).to_string())
}

fn git_text(root: &Path, args: &[&str]) -> Option<String> {
    let output = hidden_command("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::preview_push;
    use crate::models::git::GitPushPreviewRequest;
    use crate::services::git_query_service::GitQueryRuntime;
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn previews_only_commits_ahead_of_the_upstream() {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("arkline-push-preview-{}-{id}", std::process::id()));
        let remote = root.join("origin.git");
        let repository = root.join("workspace");
        fs::create_dir_all(&remote).unwrap();
        fs::create_dir_all(&repository).unwrap();
        git(&remote, &["init", "--bare", "-q"]);
        git(&repository, &["init", "-q"]);
        git(&repository, &["config", "user.name", "ArkLine Test"]);
        git(
            &repository,
            &["config", "user.email", "arkline@example.invalid"],
        );
        fs::write(repository.join("main.ets"), "one\n").unwrap();
        git(&repository, &["add", "main.ets"]);
        git(&repository, &["commit", "-m", "initial"]);
        git(
            &repository,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );
        git(&repository, &["push", "-u", "origin", "HEAD"]);
        fs::write(repository.join("main.ets"), "two\n").unwrap();
        git(&repository, &["commit", "-am", "outgoing"]);

        let preview = preview_push(
            &GitQueryRuntime::default(),
            &GitPushPreviewRequest {
                root_path: repository.to_string_lossy().into_owned(),
                request_id: "push-preview-test".into(),
                timeout_ms: 10_000,
            },
        )
        .unwrap();
        assert_eq!(preview.total_commits, 1);
        assert!(!preview.commits_truncated);
        assert_eq!(preview.commits[0].subject, "outgoing");
        let _ = fs::remove_dir_all(root);
    }

    fn git(root: &std::path::Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
