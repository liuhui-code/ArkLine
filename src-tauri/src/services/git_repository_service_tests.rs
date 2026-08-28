use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::models::git::{
    GitCommitRequest, GitFileDiffRequest, GitPathsRequest, GitRepositorySnapshotRequest,
};

use super::GitRepositoryRuntime;

#[test]
fn stages_unstages_and_commits_real_repository_changes() {
    let repository = TestRepository::new();
    repository.write("tracked.ets", "@Entry\nstruct Main {}\n");
    repository.git(&["add", "tracked.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.write("tracked.ets", "@Entry\n@Component\nstruct Main {}\n");
    repository.write("new.ets", "export const value = 1;\n");

    let runtime = GitRepositoryRuntime::default();
    let root_path = repository.path_string();
    let initial = runtime
        .snapshot(&snapshot_request(&root_path, None, 200))
        .unwrap();
    assert_eq!(initial.changes.len(), 2);
    assert!(initial
        .changes
        .iter()
        .any(|entry| entry.kind == "untracked"));

    let staged = runtime
        .stage(&GitPathsRequest {
            root_path: root_path.clone(),
            paths: vec!["new.ets".to_string()],
        })
        .unwrap();
    assert!(staged
        .snapshot
        .changes
        .iter()
        .any(|entry| entry.relative_path == "new.ets" && entry.staged));

    let unstaged = runtime
        .unstage(&GitPathsRequest {
            root_path: root_path.clone(),
            paths: vec!["new.ets".to_string()],
        })
        .unwrap();
    assert!(unstaged
        .snapshot
        .changes
        .iter()
        .any(|entry| entry.relative_path == "new.ets" && entry.kind == "untracked"));

    runtime
        .stage(&GitPathsRequest {
            root_path: root_path.clone(),
            paths: vec!["tracked.ets".to_string(), "new.ets".to_string()],
        })
        .unwrap();
    let committed = runtime
        .commit(&GitCommitRequest {
            root_path,
            message: "update files".to_string(),
            amend: false,
            sign_off: false,
        })
        .unwrap();
    assert!(committed.snapshot.changes.is_empty());
}

#[test]
fn reuses_a_bounded_snapshot_across_working_tree_pages() {
    let repository = TestRepository::new();
    for index in 0..430 {
        repository.write(
            &format!("generated-{index:04}.ets"),
            "export const value = 1;\n",
        );
    }
    let runtime = GitRepositoryRuntime::default();
    let root = repository.path_string();
    let started = Instant::now();
    let first = runtime
        .snapshot(&snapshot_request(&root, None, 100))
        .unwrap();
    assert!(
        started.elapsed().as_secs_f32() < 5.0,
        "first Git status page exceeded the 5 second release budget"
    );
    assert_eq!(first.total_changes, 430);
    assert_eq!(first.changes.len(), 100);
    assert!(first.has_more);

    repository.write(
        "arrived-after-first-page.ets",
        "export const arrivedAfterPaging = true;\n",
    );
    let second = runtime
        .snapshot(&snapshot_request(&root, first.next_cursor, 100))
        .unwrap();
    assert_eq!(second.snapshot_id, first.snapshot_id);
    assert_eq!(second.total_changes, 430);
    assert_eq!(second.changes.len(), 100);
    assert_ne!(
        second.changes[0].relative_path,
        first.changes[0].relative_path
    );
}

#[test]
fn supports_sign_off_and_message_only_amend() {
    let repository = TestRepository::new();
    repository.write("tracked.ets", "export const value = 1;\n");
    repository.git(&["add", "tracked.ets"]);
    let runtime = GitRepositoryRuntime::default();
    runtime
        .commit(&GitCommitRequest {
            root_path: repository.path_string(),
            message: "signed commit".to_string(),
            amend: false,
            sign_off: true,
        })
        .unwrap();
    assert!(repository
        .git_output(&["log", "-1", "--format=%B"])
        .contains("Signed-off-by: ArkLine Test <arkline@example.invalid>"));

    runtime
        .commit(&GitCommitRequest {
            root_path: repository.path_string(),
            message: "amended subject".to_string(),
            amend: true,
            sign_off: false,
        })
        .unwrap();
    assert_eq!(
        repository.git_output(&["log", "-1", "--format=%s"]).trim(),
        "amended subject"
    );
}

#[test]
fn compares_head_index_and_worktree_documents() {
    let repository = TestRepository::new();
    repository.write("tracked.ets", "baseline\n");
    repository.git(&["add", "tracked.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.write("tracked.ets", "staged\n");
    repository.git(&["add", "tracked.ets"]);
    repository.write("tracked.ets", "working tree\n");

    let runtime = GitRepositoryRuntime::default();
    let staged = runtime
        .file_comparison(&diff_request(&repository, "tracked.ets", true))
        .unwrap();
    assert_eq!(staged.before.content.as_deref(), Some("baseline\n"));
    assert_eq!(staged.after.content.as_deref(), Some("staged\n"));

    let unstaged = runtime
        .file_comparison(&diff_request(&repository, "tracked.ets", false))
        .unwrap();
    assert_eq!(unstaged.before.content.as_deref(), Some("staged\n"));
    assert_eq!(unstaged.after.content.as_deref(), Some("working tree\n"));
}

#[test]
fn compares_untracked_and_deleted_documents() {
    let repository = TestRepository::new();
    repository.write("old.ets", "tracked\n");
    repository.git(&["add", "old.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.write("new.ets", "untracked\n");

    let runtime = GitRepositoryRuntime::default();
    let untracked = runtime
        .file_comparison(&diff_request(&repository, "new.ets", false))
        .unwrap();
    assert!(!untracked.before.exists);
    assert_eq!(untracked.after.content.as_deref(), Some("untracked\n"));

    repository.git(&["rm", "old.ets"]);
    let deleted = runtime
        .file_comparison(&diff_request(&repository, "old.ets", true))
        .unwrap();
    assert_eq!(deleted.before.content.as_deref(), Some("tracked\n"));
    assert!(!deleted.after.exists);
}

#[test]
fn compares_untracked_documents_before_the_first_commit() {
    let repository = TestRepository::new();
    repository.write("new.ets", "untracked\n");
    let runtime = GitRepositoryRuntime::default();
    let mut request = diff_request(&repository, "new.ets", false);
    request.scope = Some("commit".to_string());

    let comparison = runtime.file_comparison(&request).unwrap();
    assert!(!comparison.before.exists);
    assert_eq!(comparison.after.content.as_deref(), Some("untracked\n"));
    assert!(comparison.patch.content.contains("+untracked"));
}

#[test]
fn uses_the_original_path_for_a_staged_rename() {
    let repository = TestRepository::new();
    repository.write("old.ets", "tracked\n");
    repository.git(&["add", "old.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.git(&["mv", "old.ets", "renamed.ets"]);
    let runtime = GitRepositoryRuntime::default();
    let mut request = diff_request(&repository, "renamed.ets", true);
    request.original_path = Some("old.ets".to_string());

    let renamed = runtime.file_comparison(&request).unwrap();
    assert_eq!(renamed.before.content.as_deref(), Some("tracked\n"));
    assert_eq!(renamed.after.content.as_deref(), Some("tracked\n"));
}

fn snapshot_request(
    root_path: &str,
    cursor: Option<String>,
    limit: u32,
) -> GitRepositorySnapshotRequest {
    GitRepositorySnapshotRequest {
        root_path: root_path.to_string(),
        cursor,
        limit,
        request_id: format!("repository-test-{limit}"),
        timeout_ms: 10_000,
    }
}

fn diff_request(
    repository: &TestRepository,
    relative_path: &str,
    staged: bool,
) -> GitFileDiffRequest {
    GitFileDiffRequest {
        root_path: repository.path_string(),
        relative_path: relative_path.to_string(),
        original_path: None,
        staged,
        scope: None,
        request_id: format!("comparison-{relative_path}-{staged}"),
        timeout_ms: 10_000,
        max_bytes: 1024 * 1024,
    }
}

struct TestRepository {
    path: PathBuf,
}

impl TestRepository {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("arkline-git-test-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        let repository = Self { path };
        repository.git(&["init", "-q"]);
        repository.git(&["config", "user.name", "ArkLine Test"]);
        repository.git(&["config", "user.email", "arkline@example.invalid"]);
        repository
    }

    fn write(&self, relative_path: &str, content: &str) {
        fs::write(self.path.join(relative_path), content).unwrap();
    }

    fn git(&self, args: &[&str]) {
        self.git_output(args);
    }

    fn git_output(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl Drop for TestRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn rejects_paths_outside_the_repository() {
    let repository = TestRepository::new();
    let error = GitRepositoryRuntime::default()
        .stage(&GitPathsRequest {
            root_path: repository.path_string(),
            paths: vec!["../outside.ets".to_string()],
        })
        .unwrap_err();
    assert_eq!(error, "Git path must stay inside the repository");
}
