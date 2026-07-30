use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{
    GitConflictContentRequest, GitRepositoryActionRequest, GitResolveConflictRequest,
};
use crate::services::git_repository_service::GitRepositoryRuntime;

#[test]
fn loads_resolves_and_continues_a_real_merge_conflict() {
    let fixture = ConflictFixture::new();
    fixture.create_merge_conflict();
    let runtime = GitRepositoryRuntime::default();
    let content = runtime
        .conflict_content(&fixture.content_request())
        .unwrap();
    assert_eq!(content.base.content.as_deref(), Some("base\n"));
    assert_eq!(content.current.content.as_deref(), Some("current\n"));
    assert_eq!(content.incoming.content.as_deref(), Some("incoming\n"));

    let resolved = runtime
        .resolve_conflict(&GitResolveConflictRequest {
            root_path: fixture.path_string(),
            relative_path: "shared.ets".to_string(),
            resolution: "content".to_string(),
            content: Some("current\nincoming\n".to_string()),
        })
        .unwrap();
    assert!(!resolved
        .snapshot
        .changes
        .iter()
        .any(|entry| entry.conflicted));

    let completed = runtime
        .repository_action(&fixture.action_request("continue"))
        .unwrap();
    assert_eq!(completed.snapshot.operation, "idle");
    assert_eq!(
        fs::read_to_string(fixture.root.join("shared.ets")).unwrap(),
        "current\nincoming\n"
    );
}

#[test]
fn aborts_a_real_merge_conflict() {
    let fixture = ConflictFixture::new();
    fixture.create_merge_conflict();
    let runtime = GitRepositoryRuntime::default();
    let aborted = runtime
        .repository_action(&fixture.action_request("abort"))
        .unwrap();
    assert_eq!(aborted.snapshot.operation, "idle");
    assert_eq!(
        fs::read_to_string(fixture.root.join("shared.ets")).unwrap(),
        "current\n"
    );
}

struct ConflictFixture {
    root: PathBuf,
    initial_branch: String,
}

impl ConflictFixture {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "arkline-conflict-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init", "-q"]);
        run_git(&root, &["config", "user.name", "ArkLine Test"]);
        run_git(&root, &["config", "user.email", "arkline@example.invalid"]);
        fs::write(root.join("shared.ets"), "base\n").unwrap();
        run_git(&root, &["add", "shared.ets"]);
        run_git(&root, &["commit", "-q", "-m", "base"]);
        let initial_branch = git_output(&root, &["branch", "--show-current"]);
        Self {
            root,
            initial_branch,
        }
    }

    fn create_merge_conflict(&self) {
        run_git(&self.root, &["checkout", "-q", "-b", "incoming"]);
        self.commit_content("incoming\n", "incoming");
        run_git(&self.root, &["checkout", "-q", &self.initial_branch]);
        self.commit_content("current\n", "current");
        let output = Command::new("git")
            .args(["merge", "incoming"])
            .current_dir(&self.root)
            .output()
            .unwrap();
        assert!(!output.status.success(), "merge should conflict");
    }

    fn commit_content(&self, content: &str, message: &str) {
        fs::write(self.root.join("shared.ets"), content).unwrap();
        run_git(&self.root, &["add", "shared.ets"]);
        run_git(&self.root, &["commit", "-q", "-m", message]);
    }

    fn content_request(&self) -> GitConflictContentRequest {
        GitConflictContentRequest {
            root_path: self.path_string(),
            relative_path: "shared.ets".to_string(),
        }
    }

    fn action_request(&self, action: &str) -> GitRepositoryActionRequest {
        GitRepositoryActionRequest {
            root_path: self.path_string(),
            action: action.to_string(),
        }
    }

    fn path_string(&self) -> String {
        self.root.to_string_lossy().to_string()
    }
}

impl Drop for ConflictFixture {
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

fn git_output(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}
