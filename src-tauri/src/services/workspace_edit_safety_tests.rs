use std::fs;

use crate::models::workspace_edit::{TextRange, WorkspaceEditOperation};
use crate::services::workspace_edit_service::apply_workspace_edit;
use crate::services::workspace_edit_test_fixture_service::{plan, text_edit, unique_temp_dir};

#[test]
fn workspace_edit_validation_failure_prevents_all_writes() {
    let root = unique_temp_dir("validation-preflight");
    let outside_root = unique_temp_dir("validation-preflight-outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside_root).unwrap();
    let inside_file = root.join("created.ets");
    let outside_file = outside_root.join("outside.ets");
    fs::write(&outside_file, "outside").unwrap();

    let edit = plan(vec![
        WorkspaceEditOperation::CreateFile {
            path: inside_file.to_string_lossy().to_string(),
            content: "created".to_string(),
            overwrite: false,
        },
        text_edit(
            outside_file.clone(),
            TextRange {
                start_line: 1,
                start_column: 1,
                end_line: 1,
                end_column: 8,
            },
            "changed",
        ),
    ]);

    let result = apply_workspace_edit(&root, &edit).unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("outside workspace root")));
    assert!(!inside_file.exists());
    assert_eq!(fs::read_to_string(&outside_file).unwrap(), "outside");

    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside_root).unwrap();
}

#[test]
fn workspace_edit_rejects_dependency_like_paths() {
    let root = unique_temp_dir("readonly-dependency-path");
    let dependency_dir = root.join("node_modules").join("package");
    fs::create_dir_all(&dependency_dir).unwrap();
    let file = dependency_dir.join("index.js");

    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateFile {
            path: file.to_string_lossy().to_string(),
            content: "generated".to_string(),
            overwrite: false,
        }]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result.conflicts.iter().any(|conflict| {
        conflict.message.contains("readonly workspace directory")
            && conflict.message.contains("node_modules")
    }));
    assert!(!file.exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_refuses_to_delete_workspace_root() {
    let root = unique_temp_dir("delete-root");
    fs::create_dir_all(root.join("src")).unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteFile {
            path: ".".to_string(),
            recursive: true,
        }]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("workspace root")));
    assert!(root.exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_same_path_rename_without_deleting_source() {
    let root = unique_temp_dir("same-path-rename");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "source").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameFile {
            old_path: file.to_string_lossy().to_string(),
            new_path: file.to_string_lossy().to_string(),
            overwrite: true,
        }]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("same path")));
    assert_eq!(fs::read_to_string(&file).unwrap(), "source");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_text_and_delete_on_same_file() {
    let root = unique_temp_dir("text-delete-same-file");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "original").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            text_edit(
                file.clone(),
                TextRange {
                    start_line: 1,
                    start_column: 1,
                    end_line: 1,
                    end_column: 9,
                },
                "changed",
            ),
            WorkspaceEditOperation::DeleteFile {
                path: file.to_string_lossy().to_string(),
                recursive: false,
            },
        ]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result.conflicts.iter().any(|conflict| {
        conflict
            .message
            .contains("Text edits cannot be mixed with file operations")
    }));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_text_edit_inside_deleted_directory() {
    let root = unique_temp_dir("text-inside-deleted-directory");
    let directory = root.join("src");
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join("main.ets");
    fs::write(&file, "original").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            text_edit(
                file.clone(),
                TextRange {
                    start_line: 1,
                    start_column: 1,
                    end_line: 1,
                    end_column: 9,
                },
                "changed",
            ),
            WorkspaceEditOperation::DeleteFile {
                path: directory.to_string_lossy().to_string(),
                recursive: true,
            },
        ]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("parent or child paths")));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_text_and_rename_on_same_file() {
    let root = unique_temp_dir("text-rename-same-file");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("source.ets");
    let target = root.join("target.ets");
    fs::write(&source, "source").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            text_edit(
                source.clone(),
                TextRange {
                    start_line: 1,
                    start_column: 1,
                    end_line: 1,
                    end_column: 7,
                },
                "changed",
            ),
            WorkspaceEditOperation::RenameFile {
                old_path: source.to_string_lossy().to_string(),
                new_path: target.to_string_lossy().to_string(),
                overwrite: false,
            },
        ]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(source.exists());
    assert!(!target.exists());
    assert_eq!(fs::read_to_string(&source).unwrap(), "source");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_mixed_file_and_directory_operations_before_writing() {
    let root = unique_temp_dir("mixed-file-directory-operations");
    fs::create_dir_all(&root).unwrap();
    let directory = root.join("generated");
    let file = root.join("main.ets");

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            WorkspaceEditOperation::CreateDirectory {
                path: directory.to_string_lossy().to_string(),
            },
            WorkspaceEditOperation::CreateFile {
                path: file.to_string_lossy().to_string(),
                content: "created".to_string(),
                overwrite: false,
            },
        ]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result.conflicts.iter().any(|conflict| {
        conflict
            .message
            .contains("cannot mix file and directory operations atomically")
    }));
    assert!(!directory.exists());
    assert!(!file.exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_overlapping_parent_and_child_directory_operations() {
    let root = unique_temp_dir("overlapping-directory-operations");
    let parent = root.join("generated");
    let child = parent.join("nested");
    fs::create_dir_all(&child).unwrap();
    fs::write(child.join("main.ets"), "original").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            WorkspaceEditOperation::DeleteDirectory {
                path: parent.to_string_lossy().to_string(),
                recursive: true,
            },
            WorkspaceEditOperation::DeleteDirectory {
                path: child.to_string_lossy().to_string(),
                recursive: true,
            },
        ]),
    )
    .expect("overlapping operations should be rejected during preflight");

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| { conflict.message.contains("parent or child paths") }));
    assert_eq!(
        fs::read_to_string(child.join("main.ets")).unwrap(),
        "original"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_expected_version_until_document_versions_are_supported() {
    let root = unique_temp_dir("expected-version");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "original").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::Text {
            path: file.to_string_lossy().to_string(),
            range: TextRange {
                start_line: 1,
                start_column: 1,
                end_line: 1,
                end_column: 9,
            },
            new_text: "changed".to_string(),
            expected_version: Some(1),
            expected_content_version: None,
        }]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("expectedVersion")));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rejects_stale_content_version_before_writing() {
    let root = unique_temp_dir("stale-content-version");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "external change").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::Text {
            path: file.to_string_lossy().to_string(),
            range: TextRange {
                start_line: 1,
                start_column: 1,
                end_line: 1,
                end_column: 9,
            },
            new_text: "renamed".to_string(),
            expected_version: None,
            expected_content_version: Some("fnv1a64:0000000000000000".to_string()),
        }]),
    )
    .unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("expectedContentVersion")));
    assert_eq!(fs::read_to_string(&file).unwrap(), "external change");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_uses_utf16_columns_for_text_ranges() {
    let root = unique_temp_dir("utf16-columns");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "😀width\n").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![text_edit(
            file.clone(),
            TextRange {
                start_line: 1,
                start_column: 3,
                end_line: 1,
                end_column: 8,
            },
            "height",
        )]),
    )
    .unwrap();

    assert!(result.applied);
    assert_eq!(fs::read_to_string(&file).unwrap(), "😀height\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_workspace_edit_returns_one_version_guarded_undo_plan() {
    let root = unique_temp_dir("single-undo");
    fs::create_dir_all(&root).unwrap();
    let first = root.join("Model.ts");
    let second = root.join("View.ts");
    fs::write(&first, "export const name = 'Ada';\n").unwrap();
    fs::write(&second, "console.log(name);\n").unwrap();

    let result = apply_workspace_edit(
        &root,
        &plan(vec![
            text_edit(
                first.clone(),
                TextRange {
                    start_line: 1,
                    start_column: 14,
                    end_line: 1,
                    end_column: 18,
                },
                "displayName",
            ),
            text_edit(
                second.clone(),
                TextRange {
                    start_line: 1,
                    start_column: 13,
                    end_line: 1,
                    end_column: 17,
                },
                "displayName",
            ),
        ]),
    )
    .unwrap();

    assert!(result.applied);
    let undo = result
        .undo_plan
        .expect("text edit should return a single undo plan");
    assert_eq!(undo.operations.len(), 2);
    assert!(undo.operations.iter().all(|operation| matches!(
        operation,
        WorkspaceEditOperation::Text {
            expected_content_version: Some(_),
            ..
        }
    )));

    let undone = apply_workspace_edit(&root, &undo).unwrap();
    assert!(undone.applied);
    assert_eq!(
        fs::read_to_string(&first).unwrap(),
        "export const name = 'Ada';\n"
    );
    assert_eq!(fs::read_to_string(&second).unwrap(), "console.log(name);\n");

    fs::remove_dir_all(root).unwrap();
}
