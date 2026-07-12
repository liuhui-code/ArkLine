use crate::models::workspace::{
    WorkspaceIndexStatus, WorkspaceIndexedSymbol, WorkspaceScanSummary, WorkspaceSnapshot,
};
use crate::services::workspace_index_snapshot_state_service::build_snapshot_index_state;

#[test]
fn snapshot_index_state_normalizes_paths_and_preserves_symbols() {
    let state = build_snapshot_index_state(
        &snapshot(false),
        42,
        vec![WorkspaceIndexedSymbol {
            source: "workspace".to_string(),
            kind: "class".to_string(),
            name: "Entry".to_string(),
            path: "\\workspace\\entry\\Entry.ets".to_string(),
            line: 1,
            column: 1,
            container: None,
            signature: None,
            visibility: None,
        }],
    );

    assert_eq!(state.status, WorkspaceIndexStatus::Ready);
    assert_eq!(state.root_path.as_deref(), Some("\\workspace"));
    assert_eq!(state.file_paths, vec!["\\workspace\\entry\\Entry.ets"]);
    assert_eq!(state.symbols.len(), 1);
    assert_eq!(state.indexed_at, Some(42));
    assert_eq!(state.partial_reason, None);
}

#[test]
fn snapshot_index_state_marks_truncated_scan_partial() {
    let state = build_snapshot_index_state(&snapshot(true), 99, Vec::new());

    assert_eq!(state.status, WorkspaceIndexStatus::Partial);
    assert_eq!(state.indexed_at, Some(99));
    assert!(state
        .partial_reason
        .as_deref()
        .unwrap_or_default()
        .contains("Partial workspace results"));
}

fn snapshot(truncated: bool) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        root_name: "workspace".to_string(),
        root_path: "/workspace".to_string(),
        files: vec!["/workspace/entry/Entry.ets".to_string()],
        scan_summary: WorkspaceScanSummary {
            scanned_files: if truncated { 20_000 } else { 1 },
            skipped_entries: if truncated { 4 } else { 0 },
            truncated,
            exclude_rules: vec!["node_modules".to_string()],
        },
    }
}
