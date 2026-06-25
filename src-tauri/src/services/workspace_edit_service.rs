#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::models::workspace_edit::{
    ApplyWorkspaceEditResult, EditConflict, TextRange, WorkspaceEditOperation, WorkspaceEditPlan,
    WorkspaceEditPreview,
};

const READONLY_COMPONENTS: [&str; 4] = [".git", ".hvigor", "build", "node_modules"];

pub fn preview_workspace_edit(
    workspace_root: &Path,
    plan: &WorkspaceEditPlan,
) -> Result<WorkspaceEditPreview, String> {
    let workspace_root = normalize_workspace_root(workspace_root)?;
    let mut conflicts = plan.conflicts.clone();
    let mut validated_operations = Vec::new();
    let mut text_edits_by_file: BTreeMap<PathBuf, Vec<ValidatedTextEdit>> = BTreeMap::new();
    let mut file_contents: BTreeMap<PathBuf, String> = BTreeMap::new();

    for operation in &plan.operations {
        match validate_operation(&workspace_root, operation, &mut file_contents) {
            Ok(validated) => {
                if let ValidatedOperation::Text(edit) = &validated {
                    text_edits_by_file
                        .entry(edit.path.clone())
                        .or_default()
                        .push(edit.clone());
                }
                validated_operations.push(validated);
            }
            Err(conflict) => conflicts.push(conflict),
        }
    }

    for edits in text_edits_by_file.values_mut() {
        edits.sort_by_key(|edit| edit.start);
        for pair in edits.windows(2) {
            if pair[0].end > pair[1].start {
                conflicts.push(EditConflict {
                    path: normalize_path(&pair[0].path),
                    message: "Text edits overlap".to_string(),
                });
            }
        }
    }
    conflicts.extend(validate_operation_relationships(&validated_operations));

    Ok(WorkspaceEditPreview {
        plan: plan.clone(),
        conflicts,
        affected_files: collect_affected_files(plan),
        summary: plan.operations.iter().map(summarize_operation).collect(),
    })
}

pub fn apply_workspace_edit(
    workspace_root: &Path,
    plan: &WorkspaceEditPlan,
) -> Result<ApplyWorkspaceEditResult, String> {
    if !plan.conflicts.is_empty() {
        return Ok(ApplyWorkspaceEditResult {
            applied: false,
            conflicts: plan.conflicts.clone(),
            changed_files: Vec::new(),
        });
    }

    let workspace_root = normalize_workspace_root(workspace_root)?;
    let mut conflicts = Vec::new();
    let mut validated_operations = Vec::new();
    let mut text_edits_by_file: BTreeMap<PathBuf, Vec<ValidatedTextEdit>> = BTreeMap::new();
    let mut file_contents: BTreeMap<PathBuf, String> = BTreeMap::new();

    for operation in &plan.operations {
        match validate_operation(&workspace_root, operation, &mut file_contents) {
            Ok(validated) => {
                if let ValidatedOperation::Text(edit) = &validated {
                    text_edits_by_file
                        .entry(edit.path.clone())
                        .or_default()
                        .push(edit.clone());
                }
                validated_operations.push(validated);
            }
            Err(conflict) => conflicts.push(conflict),
        }
    }

    for edits in text_edits_by_file.values_mut() {
        edits.sort_by_key(|edit| edit.start);
        for pair in edits.windows(2) {
            if pair[0].end > pair[1].start {
                conflicts.push(EditConflict {
                    path: normalize_path(&pair[0].path),
                    message: "Text edits overlap".to_string(),
                });
            }
        }
    }
    conflicts.extend(validate_operation_relationships(&validated_operations));

    if !conflicts.is_empty() {
        return Ok(ApplyWorkspaceEditResult {
            applied: false,
            conflicts,
            changed_files: Vec::new(),
        });
    }

    for (path, edits) in &mut text_edits_by_file {
        let content = file_contents
            .get_mut(path)
            .ok_or_else(|| format!("Text edit content was not loaded: {}", path.display()))?;
        edits.sort_by(|left, right| right.start.cmp(&left.start));

        for edit in edits {
            content.replace_range(edit.start..edit.end, &edit.new_text);
        }
    }

    let mut changed_files = BTreeSet::new();
    for operation in &validated_operations {
        match operation {
            ValidatedOperation::Text(_) => {}
            ValidatedOperation::CreateFile { path, content } => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(path, content).map_err(|error| error.to_string())?;
                changed_files.insert(normalize_path(path));
            }
            ValidatedOperation::RenameFile {
                old_path,
                new_path,
                overwrite,
            } => {
                if let Some(parent) = new_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                if *overwrite && new_path.exists() {
                    fs::remove_file(new_path).map_err(|error| error.to_string())?;
                }
                fs::rename(old_path, new_path).map_err(|error| error.to_string())?;
                changed_files.insert(normalize_path(old_path));
                changed_files.insert(normalize_path(new_path));
            }
            ValidatedOperation::DeleteFile { path, recursive } => {
                if path.is_dir() {
                    if *recursive {
                        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
                    }
                } else {
                    fs::remove_file(path).map_err(|error| error.to_string())?;
                }
                changed_files.insert(normalize_path(path));
            }
        }
    }

    for (path, content) in file_contents {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, content).map_err(|error| error.to_string())?;
        changed_files.insert(normalize_path(&path));
    }

    Ok(ApplyWorkspaceEditResult {
        applied: true,
        conflicts: Vec::new(),
        changed_files: changed_files.into_iter().collect(),
    })
}

#[derive(Debug, Clone)]
struct ValidatedTextEdit {
    path: PathBuf,
    start: usize,
    end: usize,
    new_text: String,
}

#[derive(Debug, Clone)]
enum ValidatedOperation {
    Text(ValidatedTextEdit),
    CreateFile {
        path: PathBuf,
        content: String,
    },
    RenameFile {
        old_path: PathBuf,
        new_path: PathBuf,
        overwrite: bool,
    },
    DeleteFile {
        path: PathBuf,
        recursive: bool,
    },
}

fn validate_operation(
    workspace_root: &Path,
    operation: &WorkspaceEditOperation,
    file_contents: &mut BTreeMap<PathBuf, String>,
) -> Result<ValidatedOperation, EditConflict> {
    match operation {
        WorkspaceEditOperation::Text {
            path,
            range,
            new_text,
            expected_version,
        } => {
            let path = validate_workspace_path(workspace_root, path)?;
            if expected_version.is_some() {
                return Err(conflict(
                    &path,
                    "expectedVersion is not supported by the workspace edit runtime yet",
                ));
            }
            if !path.exists() {
                return Err(conflict(&path, "Text edit target does not exist"));
            }
            if path.is_dir() {
                return Err(conflict(&path, "Text edit target is a directory"));
            }

            if !file_contents.contains_key(&path) {
                let content = fs::read_to_string(&path)
                    .map_err(|error| conflict(&path, error.to_string()))?;
                file_contents.insert(path.clone(), content);
            }

            let content = file_contents
                .get(&path)
                .expect("content should be loaded before range validation");
            let (start, end) = text_range_to_byte_offsets(content, range)
                .map_err(|message| conflict(&path, message))?;

            Ok(ValidatedOperation::Text(ValidatedTextEdit {
                path,
                start,
                end,
                new_text: new_text.clone(),
            }))
        }
        WorkspaceEditOperation::CreateFile {
            path,
            content,
            overwrite,
        } => {
            let path = validate_workspace_path(workspace_root, path)?;
            validate_parent(&path)?;

            if path.is_dir() {
                return Err(conflict(&path, "Create file target is a directory"));
            }
            if path.exists() && !overwrite {
                return Err(conflict(&path, "Create file target already exists"));
            }

            Ok(ValidatedOperation::CreateFile {
                path,
                content: content.clone(),
            })
        }
        WorkspaceEditOperation::RenameFile {
            old_path,
            new_path,
            overwrite,
        } => {
            let old_path = validate_workspace_path(workspace_root, old_path)?;
            let new_path = validate_workspace_path(workspace_root, new_path)?;
            validate_parent(&new_path)?;

            if !old_path.exists() {
                return Err(conflict(&old_path, "Rename source does not exist"));
            }
            if old_path.is_dir() {
                return Err(conflict(&old_path, "Rename source is a directory"));
            }
            if old_path == new_path {
                return Err(conflict(&old_path, "Rename source and target are the same path"));
            }
            if new_path.is_dir() {
                return Err(conflict(&new_path, "Rename target is a directory"));
            }
            if new_path.exists() && !overwrite {
                return Err(conflict(&new_path, "Rename target already exists"));
            }

            Ok(ValidatedOperation::RenameFile {
                old_path,
                new_path,
                overwrite: *overwrite,
            })
        }
        WorkspaceEditOperation::DeleteFile { path, recursive } => {
            let path = validate_workspace_path(workspace_root, path)?;
            if path == workspace_root {
                return Err(conflict(&path, "Delete target cannot be the workspace root"));
            }
            if !path.exists() {
                return Err(conflict(&path, "Delete target does not exist"));
            }
            if path.is_dir() && !recursive {
                return Err(conflict(
                    &path,
                    "Delete target is a directory; recursive=true is required",
                ));
            }

            Ok(ValidatedOperation::DeleteFile {
                path,
                recursive: *recursive,
            })
        }
    }
}

fn collect_affected_files(plan: &WorkspaceEditPlan) -> Vec<String> {
    if !plan.affected_files.is_empty() {
        return plan.affected_files.clone();
    }

    let mut files = BTreeSet::new();
    for operation in &plan.operations {
        match operation {
            WorkspaceEditOperation::Text { path, .. }
            | WorkspaceEditOperation::CreateFile { path, .. }
            | WorkspaceEditOperation::DeleteFile { path, .. } => {
                files.insert(path.clone());
            }
            WorkspaceEditOperation::RenameFile {
                old_path, new_path, ..
            } => {
                files.insert(old_path.clone());
                files.insert(new_path.clone());
            }
        }
    }

    files.into_iter().collect()
}

fn summarize_operation(operation: &WorkspaceEditOperation) -> String {
    match operation {
        WorkspaceEditOperation::Text { path, range, .. } => format!(
            "Edit {path} at {}:{}-{}:{}",
            range.start_line, range.start_column, range.end_line, range.end_column
        ),
        WorkspaceEditOperation::CreateFile {
            path, overwrite, ..
        } => {
            if *overwrite {
                format!("Create or overwrite {path}")
            } else {
                format!("Create {path}")
            }
        }
        WorkspaceEditOperation::RenameFile {
            old_path,
            new_path,
            overwrite,
        } => {
            if *overwrite {
                format!("Rename {old_path} to {new_path} and overwrite if needed")
            } else {
                format!("Rename {old_path} to {new_path}")
            }
        }
        WorkspaceEditOperation::DeleteFile { path, recursive } => {
            if *recursive {
                format!("Delete {path} recursively")
            } else {
                format!("Delete {path}")
            }
        }
    }
}

fn validate_operation_relationships(operations: &[ValidatedOperation]) -> Vec<EditConflict> {
    let mut conflicts = Vec::new();
    let mut text_paths = BTreeSet::new();
    let mut file_paths: BTreeMap<PathBuf, Vec<&'static str>> = BTreeMap::new();

    for operation in operations {
        match operation {
            ValidatedOperation::Text(edit) => {
                text_paths.insert(edit.path.clone());
            }
            ValidatedOperation::CreateFile { path, .. } => {
                file_paths.entry(path.clone()).or_default().push("create");
            }
            ValidatedOperation::RenameFile {
                old_path, new_path, ..
            } => {
                file_paths.entry(old_path.clone()).or_default().push("rename source");
                file_paths.entry(new_path.clone()).or_default().push("rename target");
            }
            ValidatedOperation::DeleteFile { path, .. } => {
                file_paths.entry(path.clone()).or_default().push("delete");
            }
        }
    }

    for path in &text_paths {
        if file_paths.contains_key(path) {
            conflicts.push(conflict(
                path,
                "Text edits cannot be mixed with file operations on the same path",
            ));
        }
        for file_path in file_paths.keys() {
            if path_is_ancestor(file_path, path) || path_is_ancestor(path, file_path) {
                conflicts.push(conflict(
                    path,
                    "Text edits cannot be mixed with file operations on parent or child paths",
                ));
            }
        }
    }

    for (path, roles) in file_paths {
        if roles.len() > 1 {
            conflicts.push(conflict(
                &path,
                format!("Multiple file operations affect the same path: {}", roles.join(", ")),
            ));
        }
    }

    conflicts
}

fn path_is_ancestor(parent: &Path, child: &Path) -> bool {
    parent != child && child.starts_with(parent)
}

fn normalize_workspace_root(workspace_root: &Path) -> Result<PathBuf, String> {
    if !workspace_root.exists() {
        return Err(format!(
            "Workspace root does not exist: {}",
            workspace_root.display()
        ));
    }
    if !workspace_root.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            workspace_root.display()
        ));
    }

    fs::canonicalize(workspace_root).map_err(|error| error.to_string())
}

fn validate_workspace_path(workspace_root: &Path, path: &str) -> Result<PathBuf, EditConflict> {
    let candidate = workspace_relative_path(workspace_root, path);
    let normalized = normalize_existing_or_parent(&candidate).map_err(|message| EditConflict {
        path: path.to_string(),
        message,
    })?;

    if !normalized.starts_with(workspace_root) {
        return Err(EditConflict {
            path: normalize_path(&normalized),
            message: format!(
                "Path is outside workspace root: {}",
                normalize_path(&normalized)
            ),
        });
    }

    if let Some(component) = readonly_component(workspace_root, &normalized) {
        return Err(EditConflict {
            path: normalize_path(&normalized),
            message: format!("Path is in readonly workspace directory: {component}"),
        });
    }

    Ok(normalized)
}

fn workspace_relative_path(workspace_root: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        lexical_normalize(path)
    } else {
        lexical_normalize(&workspace_root.join(path))
    }
}

fn normalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|error| error.to_string());
    }

    let mut missing_components = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(file_name) = current.file_name() else {
            break;
        };
        missing_components.push(file_name.to_os_string());
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent;
    }

    if !current.exists() {
        return Ok(lexical_normalize(path));
    }

    let mut normalized = fs::canonicalize(current).map_err(|error| error.to_string())?;
    for component in missing_components.iter().rev() {
        normalized.push(component);
    }

    Ok(lexical_normalize(&normalized))
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(value) => normalized.push(value),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn readonly_component(workspace_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(workspace_root).ok().and_then(|relative| {
        relative.components().find_map(|component| {
            let value = component.as_os_str().to_string_lossy();
            READONLY_COMPONENTS
                .contains(&value.as_ref())
                .then(|| value.to_string())
        })
    })
}

fn validate_parent(path: &Path) -> Result<(), EditConflict> {
    if let Some(parent) = path.parent() {
        if parent.exists() && !parent.is_dir() {
            return Err(conflict(path, "Parent path is not a directory"));
        }
    }
    Ok(())
}

fn text_range_to_byte_offsets(content: &str, range: &TextRange) -> Result<(usize, usize), String> {
    if range.start_line == 0
        || range.start_column == 0
        || range.end_line == 0
        || range.end_column == 0
    {
        return Err("Text range uses 1-based line and column values".to_string());
    }

    let start = line_column_to_byte_offset(content, range.start_line, range.start_column)?;
    let end = line_column_to_byte_offset(content, range.end_line, range.end_column)?;

    if start > end {
        return Err("Text range start is after end".to_string());
    }

    Ok((start, end))
}

fn line_column_to_byte_offset(content: &str, line: u32, column: u32) -> Result<usize, String> {
    let line_index = usize::try_from(line - 1).map_err(|_| "Line value is too large")?;
    let column_units = usize::try_from(column - 1).map_err(|_| "Column value is too large")?;
    let mut line_starts = vec![0usize];

    for (index, character) in content.char_indices() {
        if character == '\n' {
            line_starts.push(index + character.len_utf8());
        }
    }

    let Some(line_start) = line_starts.get(line_index).copied() else {
        return Err(format!("Line {line} is outside the file"));
    };
    let line_end = content[line_start..]
        .find('\n')
        .map(|offset| line_start + offset)
        .unwrap_or(content.len());
    let line_text = &content[line_start..line_end];
    let line_utf16_units = line_text.encode_utf16().count();

    if column_units > line_utf16_units {
        return Err(format!("Column {column} is outside line {line}"));
    }
    if column_units == line_utf16_units {
        return Ok(line_end);
    }

    let mut current_units = 0usize;
    for (offset, character) in line_text.char_indices() {
        if current_units == column_units {
            return Ok(line_start + offset);
        }
        let next_units = current_units + character.len_utf16();
        if column_units < next_units {
            return Err(format!("Column {column} is not on a UTF-16 character boundary"));
        }
        current_units = next_units;
    }

    Err(format!("Column {column} is outside line {line}"))
}

fn conflict(path: &Path, message: impl Into<String>) -> EditConflict {
    EditConflict {
        path: normalize_path(path),
        message: message.into(),
    }
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{apply_workspace_edit, preview_workspace_edit};
    use crate::models::workspace_edit::{
        EditConflict, TextRange, WorkspaceEditOperation, WorkspaceEditPlan,
    };

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-workspace-edit-{name}-{suffix}"))
    }

    fn plan(operations: Vec<WorkspaceEditOperation>) -> WorkspaceEditPlan {
        WorkspaceEditPlan {
            id: "test-plan".to_string(),
            title: "Test plan".to_string(),
            operations,
            conflicts: Vec::new(),
            affected_files: Vec::new(),
            undo_label: "Undo test plan".to_string(),
            requires_preview: false,
        }
    }

    fn text_edit(path: PathBuf, range: TextRange, new_text: &str) -> WorkspaceEditOperation {
        WorkspaceEditOperation::Text {
            path: path.to_string_lossy().to_string(),
            range,
            new_text: new_text.to_string(),
            expected_version: None,
        }
    }

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
}
