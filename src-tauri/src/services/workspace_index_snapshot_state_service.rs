use crate::models::workspace::{
    WorkspaceIndexState, WorkspaceIndexStatus, WorkspaceIndexedSymbol, WorkspaceSnapshot,
};
use crate::services::workspace_index_state_defaults_service::build_partial_reason;

pub(crate) fn build_snapshot_index_state(
    snapshot: &WorkspaceSnapshot,
    indexed_at: u128,
    symbols: Vec<WorkspaceIndexedSymbol>,
) -> WorkspaceIndexState {
    WorkspaceIndexState {
        status: snapshot_index_status(snapshot),
        root_path: Some(normalize_index_path(&snapshot.root_path)),
        file_paths: snapshot_file_paths(snapshot),
        symbols,
        indexed_at: Some(indexed_at),
        partial_reason: build_partial_reason(snapshot),
    }
}

pub(crate) fn snapshot_file_paths(snapshot: &WorkspaceSnapshot) -> Vec<String> {
    snapshot
        .files
        .iter()
        .map(|path| normalize_index_path(path))
        .collect()
}

fn snapshot_index_status(snapshot: &WorkspaceSnapshot) -> WorkspaceIndexStatus {
    if snapshot.scan_summary.truncated {
        WorkspaceIndexStatus::Partial
    } else {
        WorkspaceIndexStatus::Ready
    }
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
