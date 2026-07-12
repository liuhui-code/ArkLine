use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace_edit::{TextRange, WorkspaceEditOperation, WorkspaceEditPlan};

pub(crate) fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-workspace-edit-{name}-{suffix}"))
}

pub(crate) fn plan(operations: Vec<WorkspaceEditOperation>) -> WorkspaceEditPlan {
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

pub(crate) fn text_edit(path: PathBuf, range: TextRange, new_text: &str) -> WorkspaceEditOperation {
    WorkspaceEditOperation::Text {
        path: path.to_string_lossy().to_string(),
        range,
        new_text: new_text.to_string(),
        expected_version: None,
    }
}
