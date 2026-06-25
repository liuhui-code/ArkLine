#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEditPlan {
    pub id: String,
    pub title: String,
    pub operations: Vec<WorkspaceEditOperation>,
    #[serde(default)]
    pub conflicts: Vec<EditConflict>,
    #[serde(default)]
    pub affected_files: Vec<String>,
    pub undo_label: String,
    pub requires_preview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceEditOperation {
    Text {
        path: String,
        range: TextRange,
        new_text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        expected_version: Option<u32>,
    },
    CreateFile {
        path: String,
        content: String,
        overwrite: bool,
    },
    RenameFile {
        old_path: String,
        new_path: String,
        overwrite: bool,
    },
    DeleteFile {
        path: String,
        recursive: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditConflict {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkspaceEditResult {
    pub applied: bool,
    #[serde(default)]
    pub conflicts: Vec<EditConflict>,
    #[serde(default)]
    pub changed_files: Vec<String>,
}
