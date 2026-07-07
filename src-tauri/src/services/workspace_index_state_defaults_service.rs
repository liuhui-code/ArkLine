use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus, WorkspaceSnapshot};
use crate::services::workspace_number_format_service::format_count;

pub(crate) fn empty_state() -> WorkspaceIndexState {
    WorkspaceIndexState {
        status: WorkspaceIndexStatus::Empty,
        root_path: None,
        file_paths: Vec::new(),
        symbols: Vec::new(),
        indexed_at: None,
        partial_reason: None,
    }
}

pub(crate) fn build_partial_reason(snapshot: &WorkspaceSnapshot) -> Option<String> {
    if !snapshot.scan_summary.truncated {
        return None;
    }

    Some(format!(
        "Partial workspace results: scan stopped at {} files; excluded {} generated/dependency entries.",
        format_count(snapshot.scan_summary.scanned_files),
        format_count(snapshot.scan_summary.skipped_entries),
    ))
}
