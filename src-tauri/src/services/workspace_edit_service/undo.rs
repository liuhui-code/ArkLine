use std::collections::BTreeMap;
use std::path::PathBuf;

use super::content_version;
use crate::models::workspace_edit::{TextRange, WorkspaceEditOperation, WorkspaceEditPlan};
use crate::services::workspace_edit_path_service::normalize_path;

pub(super) fn build_text_undo_plan(
    plan: &WorkspaceEditPlan,
    original_contents: &BTreeMap<PathBuf, String>,
    applied_contents: &BTreeMap<PathBuf, String>,
) -> Option<WorkspaceEditPlan> {
    if plan.operations.is_empty()
        || !plan
            .operations
            .iter()
            .all(|operation| matches!(operation, WorkspaceEditOperation::Text { .. }))
    {
        return None;
    }

    let operations: Vec<_> = applied_contents
        .iter()
        .filter_map(|(path, applied)| {
            let original = original_contents.get(path)?;
            Some(WorkspaceEditOperation::Text {
                path: normalize_path(path),
                range: full_content_range(applied),
                new_text: original.clone(),
                expected_version: None,
                expected_content_version: Some(content_version(applied)),
            })
        })
        .collect();
    if operations.is_empty() {
        return None;
    }
    let affected_files = operations
        .iter()
        .filter_map(|operation| match operation {
            WorkspaceEditOperation::Text { path, .. } => Some(path.clone()),
            _ => None,
        })
        .collect();
    Some(WorkspaceEditPlan {
        id: format!("{}.undo", plan.id),
        title: plan.undo_label.clone(),
        operations,
        conflicts: Vec::new(),
        affected_files,
        undo_label: format!("Redo {}", plan.title),
        requires_preview: false,
    })
}

fn full_content_range(content: &str) -> TextRange {
    let mut lines = content.split('\n');
    let mut end_line = 1_u32;
    let mut last = lines.next().unwrap_or_default();
    for line in lines {
        end_line += 1;
        last = line;
    }
    TextRange {
        start_line: 1,
        start_column: 1,
        end_line,
        end_column: last.encode_utf16().count() as u32 + 1,
    }
}
