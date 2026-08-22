use std::env;
use std::fs;
use std::process::Command;

use crate::models::workspace_edit::WorkspaceEditOperation;
use crate::services::workspace_edit_service::{
    apply_workspace_edit, recover_workspace_edit_transactions,
};
use crate::services::workspace_edit_test_fixture_service::{plan, unique_temp_dir};

const HELPER_ROOT_ENV: &str = "ARKLINE_TEST_WORKSPACE_EDIT_HELPER_ROOT";
const CRASH_AFTER_REPLACEMENTS_ENV: &str = "ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_REPLACEMENTS";

#[test]
fn prepared_create_directory_removes_all_created_ancestors() {
    let root = unique_temp_dir("transaction-create-directory-recovery");
    fs::create_dir_all(&root).unwrap();
    let created_parent = root.join("generated");
    let created = created_parent.join("nested");

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_directory_transaction_tests::workspace_edit_create_directory_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(created.is_dir());

    recover_workspace_edit_transactions(&root).unwrap();

    assert!(!created_parent.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_delete_directory_restores_the_complete_tree() {
    let root = unique_temp_dir("transaction-delete-directory-recovery");
    let deleted = root.join("obsolete");
    fs::create_dir_all(deleted.join("nested")).unwrap();
    fs::write(deleted.join("nested").join("artifact.bin"), [0, 255, 7]).unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_directory_transaction_tests::workspace_edit_delete_directory_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(!deleted.exists());

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(
        fs::read(deleted.join("nested").join("artifact.bin")).unwrap(),
        [0, 255, 7]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_rename_directory_restores_source_and_overwritten_target() {
    let root = unique_temp_dir("transaction-rename-directory-recovery");
    let source = root.join("source-dir");
    let target = root.join("target-dir");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("source.bin"), [1, 0, 255]).unwrap();
    fs::write(target.join("target.bin"), [2, 0, 254]).unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_directory_transaction_tests::workspace_edit_rename_directory_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(!source.exists());
    assert_eq!(fs::read(target.join("source.bin")).unwrap(), [1, 0, 255]);

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(fs::read(source.join("source.bin")).unwrap(), [1, 0, 255]);
    assert_eq!(fs::read(target.join("target.bin")).unwrap(), [2, 0, 254]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rename_directory_recovery_refuses_an_external_third_version() {
    let root = unique_temp_dir("transaction-rename-directory-third-version");
    let source = root.join("source-dir");
    let target = root.join("target-dir");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("source.bin"), [1, 0, 255]).unwrap();
    fs::write(target.join("target.bin"), [2, 0, 254]).unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_directory_transaction_tests::workspace_edit_rename_directory_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(86));
    fs::write(target.join("external.txt"), "external").unwrap();

    let error = recover_workspace_edit_transactions(&root).unwrap_err();

    assert!(error.contains("external"));
    assert!(!source.exists());
    assert_eq!(fs::read(target.join("source.bin")).unwrap(), [1, 0, 255]);
    assert_eq!(
        fs::read_to_string(target.join("external.txt")).unwrap(),
        "external"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_create_directory_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateDirectory {
            path: root
                .join("generated")
                .join("nested")
                .to_string_lossy()
                .to_string(),
        }]),
    );
    panic!("workspace edit create-directory helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_delete_directory_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteDirectory {
            path: root.join("obsolete").to_string_lossy().to_string(),
            recursive: true,
        }]),
    );
    panic!("workspace edit delete-directory helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_rename_directory_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameDirectory {
            old_path: root.join("source-dir").to_string_lossy().to_string(),
            new_path: root.join("target-dir").to_string_lossy().to_string(),
            overwrite: true,
        }]),
    );
    panic!("workspace edit rename-directory helper did not exit at the failpoint: {result:?}");
}
