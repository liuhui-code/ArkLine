use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexQueuePressure};
use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_discovery_store_service::{
    update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_diagnostics_service::{
    inspect_workspace_index, inspect_workspace_index_with_queue_pressure,
};
use crate::services::workspace_index_event_service::store_index_event;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_performance_gate_service::{
    evaluate_deep_layer_performance, record_deep_layer_performance_report,
    WorkspaceIndexPerfGateThresholds, WorkspaceIndexStageSample,
};
use crate::services::workspace_index_resume_service::save_resume_task;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;
use rusqlite::{params, Connection};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn reports_workspace_index_schema_versions_and_table_counts() {
    let root = unique_temp_dir("workspace-index-diagnostics");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "import { Profile } from \"./Profile\"\nstruct Index {\n  build() { Text(\"Diagnostics\") }\n}\n",
    )
    .unwrap();
    fs::write(source_dir.join("Profile.ets"), "export class Profile {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.status, "ready");
    assert_eq!(diagnostics.schema_versions.get("catalog"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("content"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("symbol"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("stub"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("dependency"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("fingerprint"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("sdk"), Some(&1));
    assert_eq!(diagnostics.file_count, 2);
    assert_eq!(diagnostics.symbol_count, 3);
    assert_eq!(diagnostics.content_line_count, 5);
    assert_eq!(diagnostics.fingerprint_count, 2);
    assert_eq!(diagnostics.stub_file_count, 2);
    assert_eq!(diagnostics.stub_declaration_count, 3);
    assert_eq!(diagnostics.dependency_edge_count, 1);
    assert_eq!(diagnostics.unresolved_import_count, 0);
    assert_eq!(diagnostics.parser_error_count, 0);
    assert_eq!(diagnostics.stale_generation_count, 0);
    assert_eq!(diagnostics.sdk_symbol_count, 0);
    assert!(diagnostics.db_size_bytes > 0);
    assert_eq!(diagnostics.queue_pressure.pending_task_count, 0);
    assert_eq!(diagnostics.queue_pressure.workspace_pending_task_count, 0);
    assert!(diagnostics.last_error.is_none());
    assert!(diagnostics.last_explain_status.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_active_sdk_index_metadata_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-sdk");
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&root_path, &sdk_path, "test-sdk").unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(
        diagnostics.active_sdk_path.as_deref(),
        Some(sdk_path.as_str())
    );
    assert_eq!(diagnostics.active_sdk_version.as_deref(), Some("test-sdk"));
    assert_eq!(diagnostics.sdk_symbol_count, 2);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_discovery_state_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-discovery");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 4,
        status: "running".to_string(),
        discovered_count: 2048,
        excluded_count: 12,
        cursor: Some(WorkspaceDiscoveryCursor {
            pending_directories: vec!["entry".to_string()],
        }),
        error: None,
    })
    .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.discovery_status.as_deref(), Some("running"));
    assert_eq!(diagnostics.discovered_file_count, 2048);
    assert_eq!(diagnostics.discovery_excluded_count, 12);
    assert!(diagnostics.discovery_has_more);

    fs::remove_dir_all(root).unwrap();
}

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

#[test]
fn reports_parser_failure_details_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-parser-failures");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let broken_path = source_dir.join("Broken.ets");
    fs::write(&broken_path, "class Broken {\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.parser_failures.len(), 1);
    assert_eq!(
        diagnostics.parser_failures[0].path,
        broken_path.to_string_lossy()
    );
    assert_eq!(diagnostics.parser_failures[0].line, 1);
    assert!(!diagnostics.parser_failures[0].message.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_unresolved_import_details_for_diagnostics() {
    let root = unique_temp_dir("workspace-index-diagnostics-unresolved-imports");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let root_key = root_path.replace('/', "\\");
    let source_path = root
        .join("entry")
        .join("src")
        .join("main")
        .join("ets")
        .join("Index.ets");
    let path_key = source_path.to_string_lossy().replace('/', "\\");
    fs::create_dir_all(root.join(".arkline").join("index")).unwrap();
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    ensure_workspace_index_schema(&connection).unwrap();
    connection
        .execute(
            "insert into workspace_unresolved_imports (root_path, from_path, source_module, line, column)
             values (?1, ?2, './MissingProfile', 2, 8)",
            params![root_key, path_key],
        )
        .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.unresolved_imports.len(), 1);
    assert_eq!(
        diagnostics.unresolved_imports[0].source_module,
        "./MissingProfile"
    );
    assert_eq!(diagnostics.unresolved_imports[0].line, 2);
    assert_eq!(diagnostics.unresolved_imports[0].column, 8);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_resume_repair_action_for_persisted_resume_tasks() {
    let root = unique_temp_dir("workspace-index-diagnostics-resume-action");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let source_file = source_dir.join("Resume.ets");
    fs::write(&source_file, "struct Resume {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    save_resume_task(
        &root_path,
        &WorkspaceIndexTask {
            root_path: root_path.clone(),
            kind: WorkspaceIndexTaskKind::ChangedPaths,
            priority: WorkspaceIndexTaskPriority::FullRefresh,
            changed_paths: vec![source_file.to_string_lossy().to_string()],
            sdk_path: None,
            sdk_version: None,
            generation: 7,
            reason: "full-refresh-continuation:refresh-workspace".to_string(),
        },
    )
    .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert!(diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "resumeIndexing"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_queued_diagnostics_when_workspace_work_is_pending() {
    let root = unique_temp_dir("workspace-index-diagnostics-queued");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let queue_pressure = WorkspaceIndexQueuePressure {
        root_path: root_path.clone(),
        pending_task_count: 1,
        workspace_pending_task_count: 1,
        highest_priority: Some("full-refresh".to_string()),
        highest_priority_task_kind: Some("refresh-workspace".to_string()),
    };

    let diagnostics =
        inspect_workspace_index_with_queue_pressure(&root_path, queue_pressure).unwrap();

    assert_eq!(diagnostics.status, "queued");
    assert_eq!(diagnostics.queue_pressure.workspace_pending_task_count, 1);
    assert!(!diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "rebuildProjectIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_queued_diagnostics_when_sdk_index_work_is_pending() {
    let root = unique_temp_dir("workspace-index-diagnostics-sdk-queued");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let queue_pressure = WorkspaceIndexQueuePressure {
        root_path: root_path.clone(),
        pending_task_count: 1,
        workspace_pending_task_count: 1,
        highest_priority: Some("sdk-indexing".to_string()),
        highest_priority_task_kind: Some("sdk".to_string()),
    };

    let diagnostics =
        inspect_workspace_index_with_queue_pressure(&root_path, queue_pressure).unwrap();

    assert_eq!(diagnostics.status, "queued");
    assert_eq!(diagnostics.sdk_symbol_count, 0);
    assert!(!diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "configureSdk" || action == "rebuildSdkIndex"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_sdk_symbol_count_for_the_active_sdk_only() {
    let root = unique_temp_dir("workspace-index-diagnostics-active-sdk-count");
    let old_sdk_root = root.join("old-openharmony");
    let new_sdk_root = root.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class Legacy {\n  oldOnly(value: Length): Legacy;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class Current {\n  currentOnly(value: Length): Current;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&root_path, &old_sdk_path, "old-sdk").unwrap();
    index_workspace_sdk_symbols(&root_path, &new_sdk_path, "new-sdk").unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(
        diagnostics.active_sdk_path.as_deref(),
        Some(new_sdk_path.as_str())
    );
    assert_eq!(diagnostics.active_sdk_version.as_deref(), Some("new-sdk"));
    assert_eq!(diagnostics.sdk_symbol_count, 2);

    fs::remove_dir_all(root).unwrap();
}
