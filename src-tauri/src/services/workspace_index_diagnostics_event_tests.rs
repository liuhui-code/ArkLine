use std::fs;

use crate::models::workspace::WorkspaceIndexEvent;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_event_service::store_index_event;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_performance_gate_service::{
    evaluate_deep_layer_performance, record_deep_layer_performance_report,
    WorkspaceIndexPerfGateThresholds, WorkspaceIndexStageSample,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;

#[test]
fn reports_recent_unified_index_events_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-events");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index { build() {} }\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager.drain_index_task_results(&runtime).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.recent_events.len(), 4);
    assert_eq!(diagnostics.recent_events[0].phase, "queued");
    assert_eq!(diagnostics.recent_events[1].phase, "running");
    assert!(diagnostics.recent_events.iter().any(|event| {
        event.phase == "ready" && event.task_id.as_deref() == Some("1:refresh-workspace")
    }));
    assert!(diagnostics
        .recent_events
        .iter()
        .any(|event| event.kind == "changed-paths" && event.phase == "queued"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_task_timeline_from_unified_index_events() {
    let root = unique_temp_dir("workspace-index-diagnostics-timeline");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index { build() {} }\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.refresh_workspace_index(&root_path).unwrap();
    manager.drain_index_task_results(&runtime).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.timeline.len(), 4);
    assert_eq!(diagnostics.timeline[0].scope, "task");
    assert_eq!(diagnostics.timeline[0].phase, "queued");
    assert_eq!(diagnostics.timeline[0].title, "refresh-workspace queued");
    assert!(diagnostics.timeline.iter().any(|event| {
        event.phase == "ready"
            && event.task_id.as_deref() == Some("1:refresh-workspace")
            && event.duration_ms.is_some()
    }));
    assert!(diagnostics
        .timeline
        .iter()
        .any(|event| event.phase == "queued" && event.title == "changed-paths queued"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_deep_layer_performance_gate_events_in_timeline() {
    let root = unique_temp_dir("workspace-index-diagnostics-performance");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let report = evaluate_deep_layer_performance(
        vec![WorkspaceIndexStageSample {
            source: "project".to_string(),
            stage: "referenceRefresh".to_string(),
            duration_ms: 420,
            path_count: 128,
            chunk_index: Some(2),
            detail: None,
        }],
        WorkspaceIndexPerfGateThresholds {
            foreground_ready_ms: 500,
            deep_tick_ms: 1_000,
            stage_ms: 250,
        },
    );
    record_deep_layer_performance_report(&root_path, &report).unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert!(diagnostics.timeline.iter().any(|event| {
        event.scope == "performance"
            && event.kind == "deep-layer"
            && event.phase == "threshold"
            && event.message.contains("referenceRefresh")
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_latest_error_and_query_explain_status_from_events() {
    let root = unique_temp_dir("workspace-index-diagnostics-latest-events");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let root_key = root_path.replace('/', "\\");

    store_index_event(
        &root_path,
        &WorkspaceIndexEvent {
            event_id: "task:error:100".to_string(),
            root_path: root_key.clone(),
            scope: "task".to_string(),
            kind: "refresh-workspace".to_string(),
            phase: "failed".to_string(),
            severity: "error".to_string(),
            message: "Parser exploded".to_string(),
            task_id: Some("1:refresh-workspace".to_string()),
            generation: Some(1),
            payload_json: "{}".to_string(),
            created_at: 100,
        },
    )
    .unwrap();
    store_index_event(
        &root_path,
        &WorkspaceIndexEvent {
            event_id: "query:blocked:200".to_string(),
            root_path: root_key,
            scope: "query".to_string(),
            kind: "definition".to_string(),
            phase: "blocked".to_string(),
            severity: "warning".to_string(),
            message: "SDK index is not ready".to_string(),
            task_id: None,
            generation: None,
            payload_json: "{}".to_string(),
            created_at: 200,
        },
    )
    .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.last_error.as_deref(), Some("Parser exploded"));
    assert_eq!(diagnostics.last_explain_status.as_deref(), Some("blocked"));

    fs::remove_dir_all(root).unwrap();
}
