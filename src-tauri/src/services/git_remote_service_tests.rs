use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::GitRemoteOperationRequest;
use crate::services::git_repository_service::GitRepositoryRuntime;

#[test]
fn pushes_first_branch_with_upstream_then_fetches() {
    let fixture = RemoteFixture::new();
    fixture.write("main.ets", "export const value = 1;\n");
    fixture.git(&["add", "main.ets"]);
    fixture.git(&["commit", "-m", "initial"]);
    let branch = fixture.current_branch();
    fixture.git(&[
        "remote",
        "add",
        "origin",
        fixture.remote.to_string_lossy().as_ref(),
    ]);
    let runtime = GitRepositoryRuntime::default();

    let pushed = runtime.remote_operation(&fixture.request("push")).unwrap();
    let expected_upstream = format!("origin/{branch}");
    assert_eq!(
        pushed.snapshot.upstream.as_deref(),
        Some(expected_upstream.as_str())
    );
    assert!(fixture.remote_has_ref(&format!("refs/heads/{branch}")));

    let fetched = runtime.remote_operation(&fixture.request("fetch")).unwrap();
    assert_eq!(fetched.message, "Fetched origin");
}

struct RemoteFixture {
    root: PathBuf,
    repository: PathBuf,
    remote: PathBuf,
}

impl RemoteFixture {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "arkline-remote-test-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("workspace");
        let remote = root.join("origin.git");
        fs::create_dir_all(&repository).unwrap();
        fs::create_dir_all(&remote).unwrap();
        run_git(&remote, &["init", "--bare", "-q"]);
        run_git(&repository, &["init", "-q"]);
        run_git(&repository, &["config", "user.name", "ArkLine Test"]);
        run_git(
            &repository,
            &["config", "user.email", "arkline@example.invalid"],
        );
        Self {
            root,
            repository,
            remote,
        }
    }

    fn request(&self, operation: &str) -> GitRemoteOperationRequest {
        GitRemoteOperationRequest {
            root_path: self.repository.to_string_lossy().to_string(),
            operation: operation.to_string(),
            remote: None,
            branch: None,
            timeout_ms: 10_000,
        }
    }

    fn write(&self, relative_path: &str, content: &str) {
        fs::write(self.repository.join(relative_path), content).unwrap();
    }

    fn git(&self, args: &[&str]) {
        run_git(&self.repository, args);
    }

    fn current_branch(&self) -> String {
        let output = Command::new("git")
            .args(["symbolic-ref", "--short", "HEAD"])
            .current_dir(&self.repository)
            .output()
            .unwrap();
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }

    fn remote_has_ref(&self, reference: &str) -> bool {
        Command::new("git")
            .args(["show-ref", "--verify", reference])
            .current_dir(&self.remote)
            .output()
            .unwrap()
            .status
            .success()
    }
}

impl Drop for RemoteFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn run_git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
