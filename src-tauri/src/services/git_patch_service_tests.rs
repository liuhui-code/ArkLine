use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::git::{GitPatchRequest, GitRestorePatchRequest};

use super::{apply_patch, restore_patch, validate_patch_body};

#[test]
fn stages_and_unstages_only_the_requested_replacement() {
    let repository = TestRepository::new();
    repository.write("main.ets", "one\nTWO\nthree\nextra\n");
    let stage_patch = "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n";
    apply_patch(&repository.root, &repository.request("stage", stage_patch)).unwrap();
    assert_eq!(repository.index_text(), "one\nTWO\nthree\n");
    assert_eq!(repository.read(), "one\nTWO\nthree\nextra\n");

    let unstage_patch = "@@ -1,3 +1,3 @@\n one\n-TWO\n+two\n three\n";
    apply_patch(
        &repository.root,
        &repository.request("unstage", unstage_patch),
    )
    .unwrap();
    assert_eq!(repository.index_text(), "one\ntwo\nthree\n");
}

#[test]
fn stages_a_selected_insertion_with_context_only_patch() {
    let repository = TestRepository::new();
    repository.write("main.ets", "one\ntwo\nthree\nnew\n");
    let patch = "@@ -1,3 +1,4 @@\n one\n two\n three\n+new\n";

    apply_patch(&repository.root, &repository.request("stage", patch)).unwrap();

    assert_eq!(repository.index_text(), "one\ntwo\nthree\nnew\n");
}

#[test]
fn discards_and_restores_only_the_requested_hunk() {
    let repository = TestRepository::new();
    repository.write("main.ets", "one\nTWO\nthree\nextra\n");
    let patch = "@@ -3,2 +3,1 @@\n three\n-extra\n";
    let backup = apply_patch(&repository.root, &repository.request("discard", patch))
        .unwrap()
        .unwrap();
    assert_eq!(repository.read(), "one\nTWO\nthree\n");

    restore_patch(
        &repository.root,
        &GitRestorePatchRequest {
            root_path: repository.path_string(),
            relative_path: "main.ets".into(),
            patch: patch.into(),
            backup_commit: backup,
        },
    )
    .unwrap();
    assert_eq!(repository.read(), "one\nTWO\nthree\nextra\n");
}

#[test]
fn rejects_malformed_or_file_spanning_patch_content() {
    assert!(validate_patch_body("--- a/other\n+++ b/other\n").is_err());
    assert!(validate_patch_body("@@ -1,1 +1,2 @@\n-old\n+new\n").is_err());
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
        let root = std::env::temp_dir().join(format!(
            "arkline-patch-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let repository = Self { root };
        repository.git(&["init", "-q"]);
        repository.git(&["config", "user.name", "ArkLine Test"]);
        repository.git(&["config", "user.email", "arkline@example.invalid"]);
        repository.write("main.ets", "one\ntwo\nthree\n");
        repository.git(&["add", "main.ets"]);
        repository.git(&["commit", "-q", "-m", "initial"]);
        repository
    }

    fn request(&self, action: &str, patch: &str) -> GitPatchRequest {
        GitPatchRequest {
            root_path: self.path_string(),
            relative_path: "main.ets".into(),
            patch: patch.into(),
            action: action.into(),
        }
    }

    fn write(&self, path: &str, content: &str) {
        fs::write(self.root.join(path), content).unwrap();
    }
    fn read(&self) -> String {
        fs::read_to_string(self.root.join("main.ets")).unwrap()
    }
    fn index_text(&self) -> String {
        self.git_text(&["show", ":main.ets"])
    }
    fn path_string(&self) -> String {
        self.root.to_string_lossy().to_string()
    }
    fn git(&self, args: &[&str]) {
        assert!(run_git(&self.root, args).status.success());
    }
    fn git_text(&self, args: &[&str]) -> String {
        String::from_utf8_lossy(&run_git(&self.root, args).stdout).to_string()
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
