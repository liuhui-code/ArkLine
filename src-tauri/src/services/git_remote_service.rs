use std::io::Read;
use std::path::Path;
use std::process::{Child, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::git::GitRemoteOperationRequest;
use crate::services::process_command_service::hidden_command;

const MIN_TIMEOUT_MS: u64 = 5_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

pub fn run_remote_operation(
    root: &Path,
    request: &GitRemoteOperationRequest,
) -> Result<String, String> {
    let plan = plan_remote_operation(root, request)?;
    let timeout = Duration::from_millis(request.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
    let output = run_git_with_timeout(root, &plan.args, timeout)?;
    if output.status.success() {
        return Ok(plan.success_message);
    }
    Err(remote_error(&output.stderr))
}

struct RemoteOperationPlan {
    args: Vec<String>,
    success_message: String,
}

fn plan_remote_operation(
    root: &Path,
    request: &GitRemoteOperationRequest,
) -> Result<RemoteOperationPlan, String> {
    let remote = request
        .remote
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| default_remote(root))
        .ok_or_else(|| "No Git remote is configured for this repository".to_string())?;
    match request.operation.as_str() {
        "fetch" => Ok(RemoteOperationPlan {
            args: vec!["fetch".into(), "--prune".into(), remote.clone()],
            success_message: format!("Fetched {remote}"),
        }),
        "pull" | "pullRebase" | "pullMerge" => {
            let (branch, upstream) = branch_context(root, request.branch.as_deref())?;
            let strategy = match request.operation.as_str() {
                "pullRebase" => "--rebase",
                "pullMerge" => "--no-rebase",
                _ => "--ff-only",
            };
            let args = if upstream {
                vec!["pull".into(), strategy.into()]
            } else {
                vec!["pull".into(), strategy.into(), remote.clone(), branch]
            };
            Ok(RemoteOperationPlan {
                args,
                success_message: match request.operation.as_str() {
                    "pullRebase" => "Updated with rebase",
                    "pullMerge" => "Updated with merge",
                    _ => "Pulled with fast-forward only",
                }
                .to_string(),
            })
        }
        "push" | "forcePush" => {
            let (branch, upstream) = branch_context(root, request.branch.as_deref())?;
            let force = request.operation == "forcePush";
            let args = if upstream && force {
                vec!["push".into(), "--force-with-lease".into()]
            } else if upstream {
                vec!["push".into()]
            } else if force {
                vec![
                    "push".into(),
                    "--force-with-lease".into(),
                    "--set-upstream".into(),
                    remote.clone(),
                    branch,
                ]
            } else {
                vec![
                    "push".into(),
                    "--set-upstream".into(),
                    remote.clone(),
                    branch,
                ]
            };
            Ok(RemoteOperationPlan {
                args,
                success_message: if force {
                    format!("Force-pushed with lease to {remote}")
                } else {
                    format!("Pushed to {remote}")
                },
            })
        }
        _ => Err("Unsupported Git remote operation".to_string()),
    }
}

fn branch_context(root: &Path, requested: Option<&str>) -> Result<(String, bool), String> {
    let branch = requested
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| git_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]))
        .ok_or_else(|| "Pull and push require a checked-out local branch".to_string())?;
    let upstream = git_text(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .is_some();
    Ok((branch, upstream))
}

fn default_remote(root: &Path) -> Option<String> {
    let remotes = git_text(root, &["remote"])?;
    let mut names = remotes
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let first = names.next()?.to_string();
    Some(
        if first == "origin" || names.clone().any(|name| name == "origin") {
            "origin".to_string()
        } else {
            first
        },
    )
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

struct GitProcessOutput {
    status: ExitStatus,
    stderr: Vec<u8>,
}

fn run_git_with_timeout(
    root: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<GitProcessOutput, String> {
    let mut child = hidden_command("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout_reader = spawn_reader(child.stdout.take());
    let stderr_reader = spawn_reader(child.stderr.take());
    let status = wait_for_process(&mut child, timeout)?;
    let _stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok(GitProcessOutput { status, stderr })
}

fn spawn_reader<R: Read + Send + 'static>(reader: Option<R>) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut reader) = reader {
            let _ = reader.read_to_end(&mut bytes);
        }
        bytes
    })
}

fn wait_for_process(child: &mut Child, timeout: Duration) -> Result<ExitStatus, String> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Git operation timed out after {} seconds",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn remote_error(stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    let normalized = message.to_lowercase();
    if normalized.contains("authentication")
        || normalized.contains("could not read username")
        || normalized.contains("terminal prompts disabled")
    {
        "Git authentication failed. Configure a credential helper or SSH key, then retry."
            .to_string()
    } else if message.is_empty() {
        "Git remote operation failed".to_string()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use super::remote_error;

    #[test]
    fn explains_noninteractive_authentication_failures() {
        assert!(
            remote_error(b"fatal: could not read Username: terminal prompts disabled")
                .contains("credential helper")
        );
    }
}

#[cfg(test)]
#[path = "git_remote_service_tests.rs"]
mod integration_tests;
