use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{GitPathsRequest, GitRestoreDiscardRequest};

use super::{discard_paths, restore_discard};

static NEXT_TEST_REPOSITORY: AtomicU64 = AtomicU64::new(1);

#[test]
fn discards_and_restores_tracked_and_untracked_changes() {
    let repository = TestRepository::new(true);
    repository.write("tracked.ets", "const value = 2;\n");
    repository.write("new.ets", "export const added = true;\n");
    let request = GitPathsRequest {
        root_path: repository.path_string(),
        paths: vec!["tracked.ets".into(), "new.ets".into()],
    };

    let backup = discard_paths(&repository.root, &request).unwrap();
    assert!(repository
        .git_text(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/arkline/discard",
        ])
        .contains(&backup));
    assert_eq!(repository.read("tracked.ets"), "const value = 1;\n");
    assert!(!repository.root.join("new.ets").exists());

    restore_discard(
        &repository.root,
        &GitRestoreDiscardRequest {
            root_path: repository.path_string(),
            backup_commit: backup,
            paths: vec!["tracked.ets".into(), "new.ets".into()],
        },
    )
    .unwrap();
    assert_eq!(repository.read("tracked.ets"), "const value = 2;\n");
    assert!(repository.root.join("new.ets").exists());
}

#[test]
fn undo_refuses_to_overwrite_edits_created_after_discard() {
    let repository = TestRepository::new(true);
    repository.write("tracked.ets", "const value = 2;\n");
    let backup = discard_paths(
        &repository.root,
        &GitPathsRequest {
            root_path: repository.path_string(),
            paths: vec!["tracked.ets".into()],
        },
    )
    .unwrap();
    repository.write("tracked.ets", "const value = 99;\n");

    let error = restore_discard(
        &repository.root,
        &GitRestoreDiscardRequest {
            root_path: repository.path_string(),
            backup_commit: backup,
            paths: vec!["tracked.ets".into()],
        },
    )
    .unwrap_err();
    assert!(error.contains("changed after"));
    assert_eq!(repository.read("tracked.ets"), "const value = 99;\n");
}

#[test]
fn restores_an_untracked_directory_from_the_safety_commit() {
    let repository = TestRepository::new(true);
    repository.write("generated/types.ets", "export type Id = string;\n");
    repository.write("generated/data.json", "{}\n");
    let request = GitPathsRequest {
        root_path: repository.path_string(),
        paths: vec!["generated".into()],
    };

    let backup = discard_paths(&repository.root, &request).unwrap();
    assert!(!repository.root.join("generated").exists());
    restore_discard(
        &repository.root,
        &GitRestoreDiscardRequest {
            root_path: repository.path_string(),
            backup_commit: backup,
            paths: vec!["generated".into()],
        },
    )
    .unwrap();

    assert_eq!(
        repository.read("generated/types.ets"),
        "export type Id = string;\n"
    );
    assert_eq!(repository.read("generated/data.json"), "{}\n");
}

#[test]
fn keeps_staged_content_while_backing_up_only_the_unstaged_delta() {
    let repository = TestRepository::new(true);
    repository.write("tracked.ets", "const value = 2;\n");
    repository.git(&["add", "tracked.ets"]);
    repository.write("tracked.ets", "const value = 3;\n");
    let request = GitPathsRequest {
        root_path: repository.path_string(),
        paths: vec!["tracked.ets".into()],
    };

    let backup = discard_paths(&repository.root, &request).unwrap();
    assert_eq!(repository.read("tracked.ets"), "const value = 2;\n");
    assert!(repository
        .git_text(&["diff", "--cached"])
        .contains("value = 2"));

    restore_discard(
        &repository.root,
        &GitRestoreDiscardRequest {
            root_path: repository.path_string(),
            backup_commit: backup,
            paths: vec!["tracked.ets".into()],
        },
    )
    .unwrap();
    assert_eq!(repository.read("tracked.ets"), "const value = 3;\n");
    assert!(repository
        .git_text(&["diff", "--cached"])
        .contains("value = 2"));
}

#[test]
fn refuses_to_discard_without_an_initial_commit() {
    let repository = TestRepository::new(false);
    repository.write("new.ets", "export const value = 1;\n");
    let error = discard_paths(
        &repository.root,
        &GitPathsRequest {
            root_path: repository.path_string(),
            paths: vec!["new.ets".into()],
        },
    )
    .unwrap_err();
    assert!(error.contains("initial commit"));
    assert!(repository.root.join("new.ets").exists());
}

struct TestRepository {
    root: PathBuf,
}

impl TestRepository {
    fn new(with_initial_commit: bool) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = NEXT_TEST_REPOSITORY.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "arkline-discard-test-{}-{unique}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let repository = Self { root };
        repository.git(&["init", "-q"]);
        repository.git(&["config", "user.name", "ArkLine Test"]);
        repository.git(&["config", "user.email", "arkline@example.invalid"]);
        if with_initial_commit {
            repository.write("tracked.ets", "const value = 1;\n");
            repository.git(&["add", "tracked.ets"]);
            repository.git(&["commit", "-q", "-m", "initial"]);
        }
        repository
    }

    fn write(&self, path: &str, content: &str) {
        let target = self.root.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(target, content).unwrap();
    }

    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.root.join(path)).unwrap()
    }

    fn git(&self, args: &[&str]) {
        let output = run_git(&self.root, args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_text(&self, args: &[&str]) -> String {
        String::from_utf8_lossy(&run_git(&self.root, args).stdout).to_string()
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

fn run_git(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap()
}
