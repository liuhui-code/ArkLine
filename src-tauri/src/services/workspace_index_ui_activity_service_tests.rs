use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};

#[test]
fn search_input_activity_stays_active_for_750ms() {
    let runtime = WorkspaceIndexUiActivityRuntime::default();

    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::SearchInput, 1_000)
        .unwrap();

    assert!(runtime.is_latency_sensitive(1_749).unwrap());
    assert!(!runtime.is_latency_sensitive(1_751).unwrap());
}

#[test]
fn file_open_activity_stays_active_for_1500ms() {
    let runtime = WorkspaceIndexUiActivityRuntime::default();

    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::FileOpen, 2_000)
        .unwrap();

    assert!(runtime.is_latency_sensitive(3_499).unwrap());
    assert!(!runtime.is_latency_sensitive(3_501).unwrap());
}

#[test]
fn current_activity_reports_latest_active_kind() {
    let runtime = WorkspaceIndexUiActivityRuntime::default();

    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::SearchInput, 1_000)
        .unwrap();
    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::FileOpen, 1_200)
        .unwrap();

    assert_eq!(
        runtime.current_ui_activity(1_500).unwrap(),
        Some(WorkspaceIndexUiActivityKind::FileOpen)
    );
}

#[test]
fn overlapping_activity_extends_latency_sensitive_window() {
    let runtime = WorkspaceIndexUiActivityRuntime::default();

    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::SearchInput, 1_000)
        .unwrap();
    runtime
        .record_ui_activity(WorkspaceIndexUiActivityKind::Navigation, 1_700)
        .unwrap();

    assert!(runtime.is_latency_sensitive(2_449).unwrap());
    assert!(!runtime.is_latency_sensitive(2_451).unwrap());
}
