use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::GitCheckoutBranchRequest;

use super::checkout_branch;

#[test]
fn smart_checkout_restores_tracked_and_untracked_changes() {
    let repository = TestRepository::new();
    repository.write("shared.ets", "export const value = 1;\n");
    repository.git(&["add", "shared.ets"]);
    repository.git(&["commit", "-m", "initial"]);
    repository.git(&["branch", "feature"]);
    repository.write("shared.ets", "export const value = 2;\n");
    repository.write("local.ets", "export const local = true;\n");

    let result = checkout_branch(&GitCheckoutBranchRequest {
        root_path: repository.path_string(),
        name: "feature".to_string(),
        kind: "local".to_string(),
        strategy: "stash".to_string(),
    })
    .unwrap();

    assert_eq!(result.snapshot.current_branch.as_deref(), Some("feature"));
    assert!(result.stash_restored);
    assert!(!result.stash_kept);
    assert_eq!(result.snapshot.working_tree.changed_files, 2);
    assert_eq!(repository.read("shared.ets"), "export const value = 2;\n");
    assert!(repository.path.join("local.ets").exists());
    assert!(!repository.git_succeeds(&["rev-parse", "--verify", "refs/stash"]));
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
            "arkline-branch-test-{}-{unique}",
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

    fn read(&self, relative_path: &str) -> String {
        fs::read_to_string(self.path.join(relative_path)).unwrap()
    }

    fn git(&self, args: &[&str]) {
        assert!(self.git_succeeds(args), "git command failed: {args:?}");
    }

    fn git_succeeds(&self, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(&self.path)
            .output()
            .unwrap()
            .status
            .success()
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
