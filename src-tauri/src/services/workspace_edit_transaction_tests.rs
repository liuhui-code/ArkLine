use std::env;
use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::models::workspace_edit::{TextRange, WorkspaceEditOperation};
use crate::services::workspace_edit_service::{
    apply_workspace_edit, recover_workspace_edit_transactions,
};
use crate::services::workspace_edit_test_fixture_service::{
    plan, remove_temp_dir, text_edit, unique_temp_dir,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime;
use crate::services::workspace_open_command_service::open_workspace_through_manager;

const HELPER_ROOT_ENV: &str = "ARKLINE_TEST_WORKSPACE_EDIT_HELPER_ROOT";
const CRASH_AFTER_REPLACEMENTS_ENV: &str = "ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_REPLACEMENTS";
const CRASH_AFTER_COMMIT_ENV: &str = "ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_COMMIT";
const CRASH_AFTER_TRANSACTION_DIRECTORY_ENV: &str =
    "ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_TRANSACTION_DIRECTORY";
const CRASH_AFTER_JOURNAL_PLACEHOLDER_ENV: &str =
    "ARKLINE_TEST_WORKSPACE_EDIT_EXIT_AFTER_JOURNAL_PLACEHOLDER";

#[test]
fn prepared_workspace_edit_recovers_all_old_contents_after_process_restart() {
    let root = unique_temp_dir("transaction-crash-recovery");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const displayName = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const name = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn committed_workspace_edit_recovers_all_new_contents_after_process_restart() {
    let root = unique_temp_dir("transaction-commit-recovery");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_COMMIT_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(87));
    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const displayName = 'Ada';\n"
    );
    assert_eq!(
        fs::read_to_string(&second).unwrap(),
        "console.log(displayName);\n"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_create_file_recovers_absence_after_process_restart() {
    let root = unique_temp_dir("transaction-create-file-recovery");
    fs::create_dir_all(&root).unwrap();
    let created = root.join("Generated.ets");

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_create_file_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert_eq!(fs::read_to_string(&created).unwrap(), "generated\n");

    recover_workspace_edit_transactions(&root).unwrap();

    assert!(!created.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_delete_file_recovers_original_content_after_process_restart() {
    let root = unique_temp_dir("transaction-delete-file-recovery");
    fs::create_dir_all(&root).unwrap();
    let deleted = root.join("Obsolete.ets");
    fs::write(&deleted, "keep me\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_delete_file_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(!deleted.exists());

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(fs::read_to_string(&deleted).unwrap(), "keep me\n");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_delete_file_recovers_binary_bytes_after_process_restart() {
    let root = unique_temp_dir("transaction-delete-binary-recovery");
    fs::create_dir_all(&root).unwrap();
    let deleted = root.join("artifact.bin");
    let original = [0, 159, 146, 150, 255, 10];
    fs::write(&deleted, original).unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_delete_binary_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(!deleted.exists());

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(fs::read(&deleted).unwrap(), original);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_rename_file_recovers_source_and_overwritten_target() {
    let root = unique_temp_dir("transaction-rename-file-recovery");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("A-source.bin");
    let target = root.join("B-target.bin");
    fs::write(&source, b"source\0bytes").unwrap();
    fs::write(&target, b"target\0bytes").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_rename_file_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(86));
    assert!(!source.exists());
    assert_eq!(fs::read(&target).unwrap(), b"target\0bytes");

    recover_workspace_edit_transactions(&root).unwrap();

    assert_eq!(fs::read(&source).unwrap(), b"source\0bytes");
    assert_eq!(fs::read(&target).unwrap(), b"target\0bytes");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn opening_workspace_recovers_a_prepared_workspace_edit_before_scanning() {
    let root = unique_temp_dir("transaction-open-recovery");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(86));

    let root_path = root.to_string_lossy().to_string();
    let index_manager = WorkspaceIndexManagerRuntime::default();
    open_workspace_through_manager(
        WorkspaceIndexRuntime::default(),
        index_manager.clone(),
        WorkspaceIndexUiActivityRuntime::default(),
        &root_path,
        |_, _| {},
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const name = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    wait_for_workspace_index_idle(&index_manager, &root_path);
    remove_temp_dir(&root);
}

#[test]
fn recovery_discards_a_transaction_interrupted_before_the_journal_is_durable() {
    let root = unique_temp_dir("transaction-pre-journal-recovery");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_TRANSACTION_DIRECTORY_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(85));
    recover_workspace_edit_transactions(&root).unwrap();
    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const name = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_discards_an_empty_journal_left_before_atomic_publication() {
    let root = unique_temp_dir("transaction-empty-journal-recovery");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_JOURNAL_PLACEHOLDER_ENV, "1")
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(84));
    recover_workspace_edit_transactions(&root).unwrap();
    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const name = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_refuses_to_overwrite_content_changed_after_the_crash() {
    let root = unique_temp_dir("transaction-external-change");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let status = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "services::workspace_edit_transaction_tests::workspace_edit_crash_helper",
            "--nocapture",
        ])
        .env(HELPER_ROOT_ENV, &root)
        .env(CRASH_AFTER_REPLACEMENTS_ENV, "1")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(86));
    fs::write(&second, "external third version\n").unwrap();

    let error = recover_workspace_edit_transactions(&root).unwrap_err();

    assert!(error.contains("externally changed file"));
    assert!(error.contains("View.ts"));
    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const displayName = 'Ada';\n"
    );
    assert_eq!(
        fs::read_to_string(&second).unwrap(),
        "external third version\n"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            text_edit(
                root.join("Model.ts"),
                TextRange {
                    start_line: 1,
                    start_column: 14,
                    end_line: 1,
                    end_column: 18,
                },
                "displayName",
            ),
            text_edit(
                root.join("View.ts"),
                TextRange {
                    start_line: 1,
                    start_column: 13,
                    end_line: 1,
                    end_column: 17,
                },
                "displayName",
            ),
        ]),
    );
    panic!("workspace edit helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_create_file_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateFile {
            path: root.join("Generated.ets").to_string_lossy().to_string(),
            content: "generated\n".to_string(),
            overwrite: false,
        }]),
    );
    panic!("workspace edit create-file helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_delete_file_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteFile {
            path: root.join("Obsolete.ets").to_string_lossy().to_string(),
            recursive: false,
        }]),
    );
    panic!("workspace edit delete-file helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_delete_binary_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteFile {
            path: root.join("artifact.bin").to_string_lossy().to_string(),
            recursive: false,
        }]),
    );
    panic!("workspace edit delete-binary helper did not exit at the failpoint: {result:?}");
}

#[test]
fn workspace_edit_rename_file_crash_helper() {
    let Ok(root) = env::var(HELPER_ROOT_ENV) else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameFile {
            old_path: root.join("A-source.bin").to_string_lossy().to_string(),
            new_path: root.join("B-target.bin").to_string_lossy().to_string(),
            overwrite: true,
        }]),
    );
    panic!("workspace edit rename-file helper did not exit at the failpoint: {result:?}");
}

fn wait_for_workspace_index_idle(index_manager: &WorkspaceIndexManagerRuntime, root_path: &str) {
    for _ in 0..80 {
        let statuses = index_manager.get_index_task_statuses(root_path).unwrap();
        let pressure = index_manager.get_queue_pressure(root_path).unwrap();
        let active = statuses
            .iter()
            .any(|status| matches!(status.status.as_str(), "queued" | "running"));
        if pressure.pending_task_count == 0 && !active {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    panic!("workspace index did not become idle");
}
