use std::path::{Path, PathBuf};

use crate::models::git::{
    GitBranch, GitBranchSnapshot, GitCheckoutBranchRequest, GitCheckoutBranchResult,
    GitWorkingTreeState,
};
use crate::services::process_command_service::hidden_command;

pub fn list_branches(root_path: &Path) -> Result<GitBranchSnapshot, String> {
    let root = resolve_repo_root(root_path)?;
    let current_branch = run_git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    let refs = run_git(
        &root,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut local_branches = Vec::new();
    let mut remote_branches = Vec::new();
    for line in refs.lines().filter(|line| !line.trim().is_empty()) {
        let branch = parse_branch_ref(line)?;
        if branch.kind == "remote" {
            if !branch.name.ends_with("/HEAD") {
                remote_branches.push(branch);
            }
        } else {
            local_branches.push(branch);
        }
    }
    local_branches.sort_by_key(|branch| (!branch.current, branch.name.to_lowercase()));
    remote_branches.sort_by_key(|branch| branch.name.to_lowercase());
    let recent_branches = read_recent_branches(&root, &local_branches, current_branch.as_deref());
    let detached = current_branch.is_none();
    let working_tree = read_working_tree(&root)?;
    Ok(GitBranchSnapshot {
        root_path: root.to_string_lossy().to_string(),
        current_branch: current_branch.map(|value| value.trim().to_string()),
        detached,
        local_branches,
        remote_branches,
        recent_branches,
        working_tree,
    })
}

pub fn checkout_branch(
    request: &GitCheckoutBranchRequest,
) -> Result<GitCheckoutBranchResult, String> {
    let root = resolve_repo_root(Path::new(&request.root_path))?;
    validate_branch_name(&request.name)?;
    if request.strategy != "preserve" && request.strategy != "stash" {
        return Err("Invalid Git checkout strategy".to_string());
    }
    let stashed = request.strategy == "stash" && stash_changes(&root, &request.name)?;
    if let Err(error) = switch_branch(&root, request) {
        if stashed {
            let _ = restore_stash(&root);
        }
        return Err(error);
    }
    let (stash_restored, stash_kept) = if stashed {
        restore_stash(&root)
    } else {
        (false, false)
    };
    let snapshot = list_branches(&root)?;
    let message = if stash_kept && snapshot.working_tree.conflicted_files > 0 {
        format!(
            "Switched to {}; restored changes with conflicts and kept the safety stash",
            request.name
        )
    } else if stash_kept {
        format!(
            "Switched to {}; changes were not fully restored and the safety stash was kept",
            request.name
        )
    } else if stash_restored {
        format!(
            "Switched to {}; restored working tree changes",
            request.name
        )
    } else {
        format!("Switched to {}", request.name)
    };
    Ok(GitCheckoutBranchResult {
        snapshot,
        message,
        stash_restored,
        stash_kept,
    })
}

fn switch_branch(root: &Path, request: &GitCheckoutBranchRequest) -> Result<(), String> {
    if request.kind == "remote" {
        let local_name = request
            .name
            .split_once('/')
            .map(|(_, name)| name)
            .unwrap_or(&request.name);
        if run_git(
            &root,
            &["rev-parse", "--verify", &format!("refs/heads/{local_name}")],
        )
        .is_ok()
        {
            run_git(root, &["switch", "--quiet", "--", local_name])?;
        } else {
            run_git(root, &["switch", "--quiet", "--track", "--", &request.name])?;
        }
    } else {
        run_git(root, &["switch", "--quiet", "--", &request.name])?;
    }
    Ok(())
}

fn stash_changes(root: &Path, target: &str) -> Result<bool, String> {
    if run_git(
        root,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )?
    .trim()
    .is_empty()
    {
        return Ok(false);
    }
    run_git(
        root,
        &[
            "stash",
            "push",
            "--include-untracked",
            "-m",
            &format!("ArkLine smart checkout to {target}"),
        ],
    )?;
    Ok(true)
}

fn restore_stash(root: &Path) -> (bool, bool) {
    match run_git(root, &["stash", "pop", "--index"]) {
        Ok(_) => (true, false),
        Err(_) => (true, true),
    }
}

fn parse_branch_ref(line: &str) -> Result<GitBranch, String> {
    let mut fields = line.split('\t');
    let reference = fields.next().unwrap_or_default().trim();
    let name = fields.next().unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err("Git returned an invalid branch name".to_string());
    }
    let current = fields.next().unwrap_or_default().trim() == "*";
    let upstream = fields
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let track = fields.next().unwrap_or_default();
    let (ahead, behind) = parse_track(track);
    let kind = if reference.starts_with("refs/remotes/") {
        "remote"
    } else {
        "local"
    };
    Ok(GitBranch {
        display_name: name.clone(),
        name,
        kind: kind.to_string(),
        current,
        favorite: false,
        upstream,
        ahead,
        behind,
    })
}

fn parse_track(track: &str) -> (u32, u32) {
    let ahead = track
        .split("ahead ")
        .nth(1)
        .and_then(|value| {
            value
                .split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = track
        .split("behind ")
        .nth(1)
        .and_then(|value| {
            value
                .split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn read_working_tree(root: &Path) -> Result<GitWorkingTreeState, String> {
    let output = run_git(
        root,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )?;
    let mut conflicted_files = 0;
    for line in output.lines() {
        let status = line.as_bytes().get(0..2).unwrap_or_default();
        if status.iter().any(|value| *value == b'U') || status == b"AA" || status == b"DD" {
            conflicted_files += 1;
        }
    }
    let changed_files = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    Ok(GitWorkingTreeState {
        dirty: changed_files > 0,
        changed_files,
        conflicted_files,
    })
}

fn read_recent_branches(
    root: &Path,
    local_branches: &[GitBranch],
    current: Option<&str>,
) -> Vec<String> {
    let reflog =
        run_git(root, &["reflog", "--all", "--format=%gs", "-n", "32"]).unwrap_or_default();
    let mut recent = Vec::new();
    if let Some(current) = current {
        recent.push(current.to_string());
    }
    for entry in reflog.lines() {
        let Some(movement) = entry.strip_prefix("checkout: moving from ") else {
            continue;
        };
        let Some((_, destination)) = movement.split_once(" to ") else {
            continue;
        };
        if local_branches
            .iter()
            .any(|branch| branch.name == destination)
            && !recent.iter().any(|branch| branch == destination)
        {
            recent.push(destination.to_string());
        }
        if recent.len() == 5 {
            break;
        }
    }
    if recent.len() < 5 {
        for branch in local_branches {
            if !recent.iter().any(|name| name == &branch.name) {
                recent.push(branch.name.clone());
            }
            if recent.len() == 5 {
                break;
            }
        }
    }
    recent
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

fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.contains('\n') || name.contains('\0') {
        Err("Invalid Git branch name".to_string())
    } else {
        Ok(())
    }
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
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
    Err(if stderr.is_empty() {
        "Git command failed".to_string()
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_branch_ref, parse_track};

    #[test]
    fn parses_local_and_remote_refs() {
        let local =
            parse_branch_ref("refs/heads/main\tmain\t*\torigin/main\t[ahead 2, behind 1]").unwrap();
        assert_eq!(local.kind, "local");
        assert!(local.current);
        assert_eq!((local.ahead, local.behind), (2, 1));

        let remote = parse_branch_ref("refs/remotes/origin/feature\torigin/feature\t\t\t").unwrap();
        assert_eq!(remote.kind, "remote");
        assert!(!remote.current);
    }

    #[test]
    fn parses_tracking_variants() {
        assert_eq!(parse_track("[ahead 4]"), (4, 0));
        assert_eq!(parse_track("[behind 3]"), (0, 3));
        assert_eq!(parse_track("[ahead 2, behind 5]"), (2, 5));
        assert_eq!(parse_track(""), (0, 0));
    }
}

#[cfg(test)]
#[path = "git_branch_service_tests.rs"]
mod integration_tests;
