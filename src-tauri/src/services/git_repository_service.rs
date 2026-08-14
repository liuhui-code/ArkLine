use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::git::{
    GitCommitRequest, GitConflictContent, GitConflictContentRequest, GitDiffResult,
    GitDiscardResult, GitFileComparison, GitFileDiffRequest, GitHistoryActionRequest,
    GitMutationResult, GitPatchMutationResult, GitPatchRequest, GitPathsRequest,
    GitRemoteOperationRequest, GitRepositoryActionRequest, GitRepositorySnapshot,
    GitRepositorySnapshotRequest, GitResolveConflictRequest, GitRestoreDiscardRequest,
    GitRestorePatchRequest, GitStashActionRequest, GitStashCreateRequest, GitStashDiffRequest,
    GitStashListRequest, GitStashPage,
};
use crate::services::git_query_service::{GitQueryOutput, GitQueryRuntime};
use crate::services::git_status_service::{default_snapshot_request, read_snapshot};
use crate::services::process_command_service::hidden_command;

#[derive(Clone, Default)]
pub struct GitRepositoryRuntime {
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    generation: Arc<AtomicU64>,
    queries: GitQueryRuntime,
}

impl GitRepositoryRuntime {
    pub fn snapshot(
        &self,
        request: &GitRepositorySnapshotRequest,
    ) -> Result<GitRepositorySnapshot, String> {
        read_snapshot(&self.queries, request, self.next_generation())
    }

    pub fn cancel_query(&self, request_id: &str) -> Result<bool, String> {
        self.queries.cancel(request_id)
    }

    pub fn file_diff(&self, request: &GitFileDiffRequest) -> Result<GitDiffResult, String> {
        let root = resolve_repo_root(Path::new(&request.root_path))?;
        validate_relative_path(&request.relative_path)?;
        if request.scope.as_deref() == Some("commit") && !has_head(&root) {
            return self.run_untracked_diff(&root, request);
        }
        let mut args = vec!["diff", "--no-ext-diff"];
        if request.scope.as_deref() == Some("commit") {
            args.push("HEAD");
        } else if request.staged {
            args.push("--cached");
        }
        args.extend(["--", request.relative_path.as_str()]);
        let diff = self.run_diff_query(&root, &args, request)?;
        if !diff.content.is_empty() || request.staged || is_tracked(&root, &request.relative_path) {
            return Ok(diff);
        }
        self.run_untracked_diff(&root, request)
    }

    fn run_untracked_diff(
        &self,
        root: &Path,
        request: &GitFileDiffRequest,
    ) -> Result<GitDiffResult, String> {
        self.run_diff_query(
            &root,
            &[
                "diff",
                "--no-index",
                "--",
                "/dev/null",
                request.relative_path.as_str(),
            ],
            request,
        )
    }

    pub fn file_comparison(
        &self,
        request: &GitFileDiffRequest,
    ) -> Result<GitFileComparison, String> {
        let patch = self.file_diff(request)?;
        let root = resolve_repo_root(Path::new(&request.root_path))?;
        validate_relative_path(&request.relative_path)?;
        if let Some(path) = request.original_path.as_deref() {
            validate_relative_path(path)?;
        }
        let (before, after) =
            crate::services::git_file_comparison_service::load_comparison_documents(
                &self.queries,
                &root,
                request,
            )?;
        Ok(GitFileComparison {
            relative_path: request.relative_path.clone(),
            staged: request.staged,
            before,
            after,
            patch,
        })
    }

    pub fn stage(&self, request: &GitPathsRequest) -> Result<GitMutationResult, String> {
        self.mutate(request.root_path.as_str(), |root| {
            validate_paths(&request.paths)?;
            let mut args = vec!["add", "--"];
            args.extend(request.paths.iter().map(String::as_str));
            run_git(root, &args).map(|_| format!("Staged {} file(s)", request.paths.len()))
        })
    }

    pub fn unstage(&self, request: &GitPathsRequest) -> Result<GitMutationResult, String> {
        self.mutate(request.root_path.as_str(), |root| {
            validate_paths(&request.paths)?;
            let has_head = run_git(root, &["rev-parse", "--verify", "HEAD"]).is_ok();
            let mut args = if has_head {
                vec!["restore", "--staged", "--"]
            } else {
                vec!["rm", "--cached", "--ignore-unmatch", "--"]
            };
            args.extend(request.paths.iter().map(String::as_str));
            run_git(root, &args).map(|_| format!("Unstaged {} file(s)", request.paths.len()))
        })
    }

    pub fn discard(&self, request: &GitPathsRequest) -> Result<GitDiscardResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            validate_paths(&request.paths)?;
            let backup_commit = crate::services::git_discard_service::discard_paths(root, request)?;
            Ok(GitDiscardResult {
                message: format!(
                    "Discarded {} path(s). Safety backup is available.",
                    request.paths.len()
                ),
                backup_commit,
                snapshot: self.snapshot_after_mutation(root)?,
            })
        })
    }

    pub fn restore_discard(
        &self,
        request: &GitRestoreDiscardRequest,
    ) -> Result<GitMutationResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            validate_paths(&request.paths)?;
            crate::services::git_discard_service::restore_discard(root, request)?;
            Ok(GitMutationResult {
                message: "Discarded changes restored. Safety backup was kept in Git history."
                    .to_string(),
                snapshot: self.snapshot_after_mutation(root)?,
            })
        })
    }

    pub fn apply_partial_patch(
        &self,
        request: &GitPatchRequest,
    ) -> Result<GitPatchMutationResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            validate_relative_path(&request.relative_path)?;
            let backup_commit = crate::services::git_patch_service::apply_patch(root, request)?;
            let label = match request.action.as_str() {
                "stage" => "Staged selected changes",
                "unstage" => "Unstaged selected changes",
                "discard" => "Discarded selected changes. Safety backup is available.",
                _ => "Applied selected Git changes",
            };
            Ok(GitPatchMutationResult {
                message: format!("{label}: {}", request.relative_path),
                backup_commit,
                snapshot: self.snapshot_after_mutation(root)?,
            })
        })
    }

    pub fn restore_partial_patch(
        &self,
        request: &GitRestorePatchRequest,
    ) -> Result<GitMutationResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            validate_relative_path(&request.relative_path)?;
            crate::services::git_patch_service::restore_patch(root, request)?;
            Ok(GitMutationResult {
                message: format!("Discarded selection restored: {}", request.relative_path),
                snapshot: self.snapshot_after_mutation(root)?,
            })
        })
    }

    pub fn commit(&self, request: &GitCommitRequest) -> Result<GitMutationResult, String> {
        let message = request.message.trim();
        if message.is_empty() {
            return Err("Commit message is required".to_string());
        }
        self.mutate(request.root_path.as_str(), |root| {
            let mut args = vec!["commit"];
            if request.amend {
                args.push("--amend");
            }
            if request.sign_off {
                args.push("--signoff");
            }
            args.extend(["-m", message]);
            run_git(root, &args).map(|output| first_nonempty_line(&output, "Commit created"))
        })
    }

    pub fn remote_operation(
        &self,
        request: &GitRemoteOperationRequest,
    ) -> Result<GitMutationResult, String> {
        self.mutate(request.root_path.as_str(), |root| {
            crate::services::git_remote_service::run_remote_operation(root, request)
        })
    }

    pub fn conflict_content(
        &self,
        request: &GitConflictContentRequest,
    ) -> Result<GitConflictContent, String> {
        self.with_repository_lock(&request.root_path, |root| {
            crate::services::git_conflict_service::load_conflict_content(root, request)
        })
    }

    pub fn resolve_conflict(
        &self,
        request: &GitResolveConflictRequest,
    ) -> Result<GitMutationResult, String> {
        self.mutate(&request.root_path, |root| {
            crate::services::git_conflict_service::resolve_conflict(root, request)
        })
    }

    pub fn repository_action(
        &self,
        request: &GitRepositoryActionRequest,
    ) -> Result<GitMutationResult, String> {
        self.mutate(&request.root_path, |root| {
            crate::services::git_conflict_service::run_repository_action(root, request)
        })
    }

    pub fn stashes(&self, request: &GitStashListRequest) -> Result<GitStashPage, String> {
        self.with_repository_lock(&request.root_path, |root| {
            crate::services::git_stash_service::list_stashes(root, request)
        })
    }

    pub fn create_stash(
        &self,
        request: &GitStashCreateRequest,
    ) -> Result<GitMutationResult, String> {
        self.mutate(&request.root_path, |root| {
            crate::services::git_stash_service::create_stash(root, request)
        })
    }

    pub fn stash_action(
        &self,
        request: &GitStashActionRequest,
    ) -> Result<GitMutationResult, String> {
        self.mutate(&request.root_path, |root| {
            crate::services::git_stash_service::run_stash_action(root, request)
        })
    }

    pub fn stash_diff(&self, request: &GitStashDiffRequest) -> Result<GitDiffResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            crate::services::git_stash_service::load_stash_diff(&self.queries, root, request)
        })
    }

    pub fn history_action(
        &self,
        request: &GitHistoryActionRequest,
    ) -> Result<GitMutationResult, String> {
        self.with_repository_lock(&request.root_path, |root| {
            let outcome = crate::services::git_history_service::run_commit_action(root, request);
            let snapshot = self.snapshot_after_mutation(root)?;
            match outcome {
                Ok(message) => Ok(GitMutationResult { message, snapshot }),
                Err(_error) if history_action_in_progress(&request.action, &snapshot.operation) => {
                    Ok(GitMutationResult {
                        message: format!(
                            "{} paused and requires attention",
                            history_action_label(&request.action)
                        ),
                        snapshot,
                    })
                }
                Err(error) => Err(error),
            }
        })
    }

    fn mutate<F>(&self, root_path: &str, action: F) -> Result<GitMutationResult, String>
    where
        F: FnOnce(&Path) -> Result<String, String>,
    {
        self.with_repository_lock(root_path, |root| {
            let message = action(root)?;
            let snapshot = self.snapshot_after_mutation(root)?;
            Ok(GitMutationResult { message, snapshot })
        })
    }

    fn snapshot_after_mutation(&self, root: &Path) -> Result<GitRepositorySnapshot, String> {
        let generation = self.next_generation();
        let request = default_snapshot_request(
            root.to_string_lossy().as_ref(),
            format!("git-mutation-status-{generation}"),
        );
        read_snapshot(&self.queries, &request, generation)
    }

    pub(crate) fn query_runtime(&self) -> &GitQueryRuntime {
        &self.queries
    }

    fn run_diff_query(
        &self,
        root: &Path,
        args: &[&str],
        request: &GitFileDiffRequest,
    ) -> Result<GitDiffResult, String> {
        let limit = request.max_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
        let output =
            self.queries
                .run(&request.request_id, root, args, request.timeout_ms, limit)?;
        ensure_diff_success(&output)?;
        Ok(GitDiffResult {
            content: String::from_utf8_lossy(&output.stdout).to_string(),
            truncated: output.stdout_truncated,
            total_bytes: output.stdout_total_bytes,
        })
    }

    pub(crate) fn with_repository_lock<T, F>(&self, root_path: &str, action: F) -> Result<T, String>
    where
        F: FnOnce(&Path) -> Result<T, String>,
    {
        let root = resolve_repo_root(Path::new(root_path))?;
        let key = root.to_string_lossy().to_string();
        let lock = self.repository_lock(&key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "Git repository lock is unavailable".to_string())?;
        action(&root)
    }

    fn repository_lock(&self, key: &str) -> Result<Arc<Mutex<()>>, String> {
        let mut locks = self
            .locks
            .lock()
            .map_err(|_| "Git runtime lock is unavailable".to_string())?;
        Ok(locks
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::Relaxed) + 1
    }
}

fn history_action_in_progress(action: &str, operation: &str) -> bool {
    (action == "cherryPick" && operation == "cherryPick")
        || (action == "revert" && operation == "revert")
}

fn history_action_label(action: &str) -> &str {
    if action == "cherryPick" {
        "Cherry-pick"
    } else {
        "Revert"
    }
}

fn validate_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Select at least one Git change".to_string());
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    Ok(())
}

pub(crate) fn validate_relative_path(path: &str) -> Result<(), String> {
    let parsed = Path::new(path);
    if path.is_empty()
        || parsed.is_absolute()
        || parsed
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Git path must stay inside the repository".to_string());
    }
    Ok(())
}

fn resolve_repo_root(path: &Path) -> Result<PathBuf, String> {
    let cwd = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    let resolved = run_git(cwd, &["rev-parse", "--show-toplevel"])?;
    PathBuf::from(resolved.trim())
        .canonicalize()
        .map_err(|error| error.to_string())
}

fn is_tracked(root: &Path, path: &str) -> bool {
    run_git(root, &["ls-files", "--error-unmatch", "--", path]).is_ok()
}

fn has_head(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--verify", "HEAD"]).is_ok()
}

fn first_nonempty_line(output: &str, fallback: &str) -> String {
    output
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or(fallback)
        .to_string()
}

pub(crate) fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = run_git_output(root, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    command_error(&output)
}

fn run_git_output(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    hidden_command("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Git unavailable".to_string()
            } else {
                error.to_string()
            }
        })
}

fn ensure_diff_success(output: &GitQueryOutput) -> Result<(), String> {
    if output.status.success() || output.status.code() == Some(1) {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            "Git diff failed".to_string()
        } else {
            message
        })
    }
}

fn command_error<T>(output: &std::process::Output) -> Result<T, String> {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        "Git command failed".to_string()
    } else {
        message
    })
}

#[cfg(test)]
#[path = "git_repository_service_tests.rs"]
mod integration_tests;
