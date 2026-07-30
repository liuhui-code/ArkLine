use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{
    GitStashActionRequest, GitStashCreateRequest, GitStashDiffRequest, GitStashListRequest,
};
use crate::services::git_query_service::GitQueryRuntime;

use super::{create_stash, list_stashes, load_stash_diff, parse_stash_list, run_stash_action};

#[test]
fn parses_and_pages_stable_stash_records() {
    let output = "stash@{0}\x1fabc123\x1fOn main: first\x1f100\x1e\nstash@{1}\x1fdef456\x1fOn main: second\x1f90\x1e\n";
    let entries = parse_stash_list(output).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].index, 0);
    assert_eq!(entries[1].subject, "On main: second");
    assert!(parse_stash_list("broken\x1e").is_err());
}

#[test]
fn creates_applies_pops_and_drops_real_stashes() {
    let repository = TestRepository::new();
    repository.write("tracked.ets", "one\n");
    repository.git(&["add", "tracked.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.write("tracked.ets", "two\n");
    repository.write("untracked.ets", "new\n");

    create_stash(
        &repository.path,
        &GitStashCreateRequest {
            root_path: repository.path_string(),
            message: "work in progress".to_string(),
            include_untracked: true,
            keep_index: false,
        },
    )
    .unwrap();
    let page = list_stashes(&repository.path, &list_request(&repository, 10)).unwrap();
    assert_eq!(page.total, 1);
    assert!(page.entries[0].subject.contains("work in progress"));
    assert!(!repository.path.join("untracked.ets").exists());

    let diff = load_stash_diff(
        &GitQueryRuntime::default(),
        &repository.path,
        &GitStashDiffRequest {
            root_path: repository.path_string(),
            reference: page.entries[0].reference.clone(),
            expected_commit: page.entries[0].commit.clone(),
            request_id: "stash-diff-test".to_string(),
            timeout_ms: 10_000,
            max_bytes: 1024 * 1024,
        },
    )
    .unwrap();
    assert!(diff.content.contains("tracked.ets"));
    assert!(diff.content.contains("untracked.ets"));
    assert!(!diff.truncated);

    let mut stale = action_request(&repository, "apply");
    stale.expected_commit = "0".repeat(stale.expected_commit.len());
    assert_eq!(
        run_stash_action(&repository.path, &stale).unwrap_err(),
        "The stash list changed. Refresh before running this action"
    );

    run_stash_action(&repository.path, &action_request(&repository, "apply")).unwrap();
    assert!(repository.path.join("untracked.ets").exists());
    repository.git(&["reset", "--hard", "-q"]);
    fs::remove_file(repository.path.join("untracked.ets")).unwrap();
    run_stash_action(&repository.path, &action_request(&repository, "pop")).unwrap();
    assert_eq!(
        list_stashes(&repository.path, &list_request(&repository, 10))
            .unwrap()
            .total,
        0
    );

    repository.git(&["reset", "--hard", "-q"]);
    fs::remove_file(repository.path.join("untracked.ets")).unwrap();
    repository.write("tracked.ets", "three\n");
    create_stash(
        &repository.path,
        &GitStashCreateRequest {
            root_path: repository.path_string(),
            message: "drop me".to_string(),
            include_untracked: false,
            keep_index: false,
        },
    )
    .unwrap();
    run_stash_action(&repository.path, &action_request(&repository, "drop")).unwrap();
    assert_eq!(
        list_stashes(&repository.path, &list_request(&repository, 10))
            .unwrap()
            .total,
        0
    );
}

#[test]
fn rejects_untrusted_stash_references() {
    let repository = TestRepository::new();
    let request = GitStashActionRequest {
        root_path: repository.path_string(),
        reference: "stash@{0}; rm -rf .".to_string(),
        expected_commit: "0".repeat(40),
        action: "drop".to_string(),
        restore_index: false,
    };
    assert_eq!(
        run_stash_action(&repository.path, &request).unwrap_err(),
        "Git stash reference is invalid"
    );
}

fn list_request(repository: &TestRepository, limit: u32) -> GitStashListRequest {
    GitStashListRequest {
        root_path: repository.path_string(),
        cursor: None,
        limit,
    }
}

fn action_request(repository: &TestRepository, action: &str) -> GitStashActionRequest {
    let commit = list_stashes(&repository.path, &list_request(repository, 1))
        .unwrap()
        .entries[0]
        .commit
        .clone();
    GitStashActionRequest {
        root_path: repository.path_string(),
        reference: "stash@{0}".to_string(),
        expected_commit: commit,
        action: action.to_string(),
        restore_index: false,
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
        let path = std::env::temp_dir().join(format!(
            "arkline-stash-test-{}-{unique}",
            std::process::id()
        ));
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
    fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
    fn git(&self, args: &[&str]) {
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
    }
}

impl Drop for TestRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
