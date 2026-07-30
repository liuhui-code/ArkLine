use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{
    GitCommitDetailsRequest, GitCommitFileDiffRequest, GitHistoryActionRequest, GitHistoryRequest,
};
use crate::services::git_query_service::GitQueryRuntime;
use crate::services::git_repository_service::GitRepositoryRuntime;

use super::{load_commit_details, load_commit_diff, load_commit_file_diff, load_history};

static TEST_REPOSITORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[test]
fn pages_history_and_loads_commit_details_lazily() {
    let repository = TestRepository::new();
    repository.commit_file("main.ets", "const value = 1;\n", "initial");
    repository.commit_file("main.ets", "const value = 2;\n", "update value");
    repository.commit_file("extra.ets", "export const extra = true;\n", "add extra");
    let runtime = GitQueryRuntime::default();

    let first = load_history(&runtime, &repository.history_request(None, 2)).unwrap();
    assert_eq!(first.commits.len(), 2);
    assert!(first.has_more);
    assert_eq!(first.commits[0].subject, "add extra");

    let second = load_history(&runtime, &repository.history_request(first.next_cursor, 2)).unwrap();
    assert_eq!(second.commits.len(), 1);
    assert!(!second.has_more);
    assert_eq!(second.commits[0].subject, "initial");

    let request = GitCommitDetailsRequest {
        root_path: repository.path_string(),
        commit: first.commits[0].commit.clone(),
        request_id: "history-details-test".to_string(),
        timeout_ms: 10_000,
        max_diff_bytes: 1024 * 1024,
    };
    let details = load_commit_details(&runtime, &request).unwrap();
    assert_eq!(details.files[0].path, "extra.ets");
    assert!(load_commit_diff(&runtime, &request)
        .unwrap()
        .content
        .contains("extra.ets"));

    let file_diff = load_commit_file_diff(
        &runtime,
        &GitCommitFileDiffRequest {
            root_path: repository.path_string(),
            commit: first.commits[0].commit.clone(),
            relative_path: "extra.ets".to_string(),
            previous_path: None,
            request_id: "history-file-diff-test".to_string(),
            timeout_ms: 10_000,
            max_diff_bytes: 1024 * 1024,
        },
    )
    .unwrap();
    assert!(file_diff.content.contains("extra.ets"));
    assert!(!file_diff.content.contains("main.ets"));
}

#[test]
fn cherry_picks_and_reverts_only_with_a_clean_working_tree() {
    let repository = TestRepository::new();
    repository.commit_file("main.ets", "const value = 1;\n", "initial");
    let base_branch = repository.git_output(&["branch", "--show-current"]);
    repository.git(&["branch", "feature"]);
    repository.git(&["switch", "-q", "feature"]);
    repository.commit_file("main.ets", "const value = 2;\n", "feature change");
    let commit = repository.git_output(&["rev-parse", "HEAD"]);
    repository.git(&["switch", "-q", &base_branch]);
    let runtime = GitRepositoryRuntime::default();

    let picked = runtime
        .history_action(&repository.action_request(&commit, "cherryPick"))
        .unwrap();
    assert_eq!(picked.snapshot.operation, "idle");
    assert_eq!(repository.read("main.ets"), "const value = 2;\n");

    let reverted = runtime
        .history_action(&repository.action_request(&commit, "revert"))
        .unwrap();
    assert_eq!(reverted.snapshot.operation, "idle");
    assert_eq!(repository.read("main.ets"), "const value = 1;\n");

    repository.write("local.ets", "const local = true;\n");
    let error = runtime
        .history_action(&repository.action_request(&commit, "cherryPick"))
        .unwrap_err();
    assert!(error.contains("clean working tree"));
}

#[test]
fn returns_a_recoverable_snapshot_when_cherry_pick_conflicts() {
    let repository = TestRepository::new();
    repository.commit_file("main.ets", "const value = 'base';\n", "initial");
    let base_branch = repository.git_output(&["branch", "--show-current"]);
    repository.git(&["branch", "feature"]);
    repository.git(&["switch", "-q", "feature"]);
    repository.commit_file("main.ets", "const value = 'feature';\n", "feature change");
    let commit = repository.git_output(&["rev-parse", "HEAD"]);
    repository.git(&["switch", "-q", &base_branch]);
    repository.commit_file("main.ets", "const value = 'main';\n", "main change");

    let result = GitRepositoryRuntime::default()
        .history_action(&repository.action_request(&commit, "cherryPick"))
        .unwrap();

    assert_eq!(result.snapshot.operation, "cherryPick");
    assert_eq!(result.snapshot.conflicted_changes, 1);
    assert!(result.message.contains("requires attention"));
}

struct TestRepository {
    root: PathBuf,
}

impl TestRepository {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_REPOSITORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "arkline-history-test-{}-{unique}-{sequence}",
            std::process::id(),
        ));
        fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init", "-q"]);
        run_git(&root, &["config", "user.name", "ArkLine Test"]);
        run_git(&root, &["config", "user.email", "arkline@example.invalid"]);
        Self { root }
    }

    fn commit_file(&self, path: &str, content: &str, message: &str) {
        self.write(path, content);
        run_git(&self.root, &["add", path]);
        run_git(&self.root, &["commit", "-q", "-m", message]);
    }

    fn write(&self, path: &str, content: &str) {
        fs::write(self.root.join(path), content).unwrap();
    }

    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.root.join(path)).unwrap()
    }

    fn git(&self, args: &[&str]) {
        run_git(&self.root, args);
    }

    fn git_output(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn action_request(&self, commit: &str, action: &str) -> GitHistoryActionRequest {
        GitHistoryActionRequest {
            root_path: self.path_string(),
            commit: commit.to_string(),
            action: action.to_string(),
        }
    }

    fn history_request(&self, cursor: Option<String>, limit: u32) -> GitHistoryRequest {
        GitHistoryRequest {
            root_path: self.path_string(),
            cursor,
            limit,
            request_id: format!("history-page-{limit}"),
            timeout_ms: 10_000,
        }
    }

    fn path_string(&self) -> String {
        self.root.to_string_lossy().to_string()
    }
}

impl Drop for TestRepository {
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
