use std::fs;

use crate::models::workspace_edit::{EditConflict, TextRange, WorkspaceEditOperation};
use crate::services::workspace_edit_path_service::normalize_path;
use crate::services::workspace_edit_service::{apply_workspace_edit, preview_workspace_edit};
use crate::services::workspace_edit_test_fixture_service::{plan, text_edit, unique_temp_dir};

#[test]
fn workspace_edit_text_edit_applies_inside_workspace_root() {
    let root = unique_temp_dir("text-inside-root");
    fs::create_dir_all(root.join("src")).unwrap();
    let file = root.join("src").join("main.ets");
    fs::write(&file, "hello\nworld\n").unwrap();

    let edit = plan(vec![text_edit(
        file.clone(),
        TextRange {
            start_line: 2,
            start_column: 1,
            end_line: 2,
            end_column: 6,
        },
        "ArkLine",
    )]);

    let result = apply_workspace_edit(&root, &edit).unwrap();

    assert!(result.applied);
    assert!(result.conflicts.is_empty());
    assert_eq!(fs::read_to_string(&file).unwrap(), "hello\nArkLine\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_preview_validates_without_writing_files() {
    let root = unique_temp_dir("preview-text-edit");
    fs::create_dir_all(root.join("src")).unwrap();
    let file = root.join("src").join("main.ets");
    fs::write(&file, "hello\nworld\n").unwrap();

    let edit = plan(vec![text_edit(
        file.clone(),
        TextRange {
            start_line: 2,
            start_column: 1,
            end_line: 2,
            end_column: 6,
        },
        "ArkLine",
    )]);

    let preview = preview_workspace_edit(&root, &edit).unwrap();

    assert!(preview.conflicts.is_empty());
    assert_eq!(
        preview.affected_files,
        vec![file.to_string_lossy().to_string()]
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), "hello\nworld\n");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_text_edit_outside_root_is_rejected() {
    let root = unique_temp_dir("text-outside-root");
    let outside_root = unique_temp_dir("outside-root");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside_root).unwrap();
    let outside_file = outside_root.join("main.ets");
    fs::write(&outside_file, "outside").unwrap();

    let edit = plan(vec![text_edit(
        outside_file.clone(),
        TextRange {
            start_line: 1,
            start_column: 1,
            end_line: 1,
            end_column: 8,
        },
        "changed",
    )]);

    let result = apply_workspace_edit(&root, &edit).unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("outside workspace root")));
    assert_eq!(fs::read_to_string(&outside_file).unwrap(), "outside");

    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside_root).unwrap();
}

#[test]
fn workspace_edit_create_file_refuses_overwrite_unless_enabled() {
    let root = unique_temp_dir("create-overwrite");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("existing.ets");
    fs::write(&file, "old").unwrap();

    let rejected = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateFile {
            path: file.to_string_lossy().to_string(),
            content: "new".to_string(),
            overwrite: false,
        }]),
    )
    .unwrap();

    assert!(!rejected.applied);
    assert!(rejected
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("already exists")));
    assert_eq!(fs::read_to_string(&file).unwrap(), "old");

    let applied = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateFile {
            path: file.to_string_lossy().to_string(),
            content: "new".to_string(),
            overwrite: true,
        }]),
    )
    .unwrap();

    assert!(applied.applied);
    assert_eq!(fs::read_to_string(&file).unwrap(), "new");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rename_file_refuses_target_collision_unless_enabled() {
    let root = unique_temp_dir("rename-collision");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("source.ets");
    let target = root.join("target.ets");
    fs::write(&source, "source").unwrap();
    fs::write(&target, "target").unwrap();

    let rejected = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameFile {
            old_path: source.to_string_lossy().to_string(),
            new_path: target.to_string_lossy().to_string(),
            overwrite: false,
        }]),
    )
    .unwrap();

    assert!(!rejected.applied);
    assert!(rejected
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("already exists")));
    assert_eq!(fs::read_to_string(&source).unwrap(), "source");
    assert_eq!(fs::read_to_string(&target).unwrap(), "target");

    let applied = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameFile {
            old_path: source.to_string_lossy().to_string(),
            new_path: target.to_string_lossy().to_string(),
            overwrite: true,
        }]),
    )
    .unwrap();

    assert!(applied.applied);
    assert!(!source.exists());
    assert_eq!(fs::read_to_string(&target).unwrap(), "source");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_delete_file_refuses_directories_unless_recursive() {
    let root = unique_temp_dir("delete-directory");
    let directory = root.join("src");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("main.ets"), "content").unwrap();

    let rejected = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteFile {
            path: directory.to_string_lossy().to_string(),
            recursive: false,
        }]),
    )
    .unwrap();

    assert!(!rejected.applied);
    assert!(rejected
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("directory")));
    assert!(directory.exists());

    let applied = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteFile {
            path: directory.to_string_lossy().to_string(),
            recursive: true,
        }]),
    )
    .unwrap();

    assert!(applied.applied);
    assert!(!directory.exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_create_directory_creates_nested_directory() {
    let root = unique_temp_dir("create-directory");
    fs::create_dir_all(&root).unwrap();
    let directory = root.join("src").join("pages");

    let applied = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateDirectory {
            path: directory.to_string_lossy().to_string(),
        }]),
    )
    .unwrap();

    assert!(applied.applied);
    assert!(directory.is_dir());
    let normalized_directory = normalize_path(&fs::canonicalize(&directory).unwrap());
    assert!(applied.changed_files.contains(&normalized_directory));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_create_directory_rejects_existing_file_target() {
    let root = unique_temp_dir("create-directory-file-target");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("src");
    fs::write(&file, "content").unwrap();

    let rejected = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::CreateDirectory {
            path: file.to_string_lossy().to_string(),
        }]),
    )
    .unwrap();

    assert!(!rejected.applied);
    assert!(rejected
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("file")));
    assert!(file.is_file());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_rename_directory_rejects_file_source() {
    let root = unique_temp_dir("rename-directory-file-source");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("source.ets");
    let target = root.join("target");
    fs::write(&source, "content").unwrap();

    let rejected = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::RenameDirectory {
            old_path: source.to_string_lossy().to_string(),
            new_path: target.to_string_lossy().to_string(),
            overwrite: false,
        }]),
    )
    .unwrap();

    assert!(!rejected.applied);
    assert!(rejected
        .conflicts
        .iter()
        .any(|conflict| conflict.message.contains("file")));
    assert!(source.is_file());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_delete_directory_removes_recursive_directory() {
    let root = unique_temp_dir("delete-directory-explicit");
    let directory = root.join("src");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("main.ets"), "content").unwrap();
    let normalized_directory = normalize_path(&fs::canonicalize(&directory).unwrap());

    let applied = apply_workspace_edit(
        &root,
        &plan(vec![WorkspaceEditOperation::DeleteDirectory {
            path: directory.to_string_lossy().to_string(),
            recursive: true,
        }]),
    )
    .unwrap();

    assert!(applied.applied);
    assert!(!directory.exists());
    assert!(applied.changed_files.contains(&normalized_directory));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_edit_plan_with_conflicts_does_not_apply() {
    let root = unique_temp_dir("plan-conflicts");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("main.ets");
    fs::write(&file, "original").unwrap();
    let mut edit = plan(vec![text_edit(
        file.clone(),
        TextRange {
            start_line: 1,
            start_column: 1,
            end_line: 1,
            end_column: 9,
        },
        "changed",
    )]);
    edit.conflicts.push(EditConflict {
        path: file.to_string_lossy().to_string(),
        message: "preflight conflict".to_string(),
    });

    let result = apply_workspace_edit(&root, &edit).unwrap();

    assert!(!result.applied);
    assert!(result
        .conflicts
        .iter()
        .any(|conflict| conflict.message == "preflight conflict"));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");

    fs::remove_dir_all(root).unwrap();
}
