use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_discovery_store_service::{
    update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_resume_service::save_resume_task;
use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
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
    assert_eq!(diagnostics.schema_versions.get("catalog"), Some(&2));
    assert_eq!(diagnostics.schema_versions.get("content"), Some(&4));
    assert_eq!(diagnostics.schema_versions.get("symbol"), Some(&3));
    assert_eq!(diagnostics.schema_versions.get("stub"), Some(&2));
    assert_eq!(diagnostics.schema_versions.get("dependency"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("fingerprint"), Some(&1));
    assert_eq!(diagnostics.schema_versions.get("sdk"), Some(&1));
    assert!(diagnostics
        .schema_version_actions
        .iter()
        .all(|action| action.status == "compatible"));
    assert!(diagnostics
        .schema_version_actions
        .iter()
        .any(|action| action.domain == "sdk" && action.expected_version == 1));
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
fn reports_freshness_layers_for_stale_index_versions() {
    let root = unique_temp_dir("workspace-index-diagnostics-freshness");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let ready_path = source_dir.join("Ready.ets");
    let stale_content_path = source_dir.join("StaleContent.ets");
    let stale_stub_path = source_dir.join("StaleStub.ets");
    fs::write(&ready_path, "struct Ready {}\n").unwrap();
    fs::write(&stale_content_path, "struct StaleContent {}\n").unwrap();
    fs::write(&stale_stub_path, "struct StaleStub {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    connection
        .execute(
            "update workspace_file_fingerprints
             set content_index_version = 0
             where path = ?1",
            params![stale_content_path.to_string_lossy().replace('/', "\\")],
        )
        .unwrap();
    connection
        .execute(
            "update workspace_file_fingerprints
             set stub_parser_version = 0
             where path = ?1",
            params![stale_stub_path.to_string_lossy().replace('/', "\\")],
        )
        .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let content = diagnostics
        .freshness_layers
        .iter()
        .find(|layer| layer.layer == "content")
        .expect("content freshness should be reported");
    let stub = diagnostics
        .freshness_layers
        .iter()
        .find(|layer| layer.layer == "stub")
        .expect("stub freshness should be reported");

    assert_eq!(content.ready_count, 2);
    assert_eq!(content.stale_count, 1);
    assert_eq!(content.missing_count, 0);
    assert_eq!(stub.ready_count, 2);
    assert_eq!(stub.stale_count, 1);
    assert_eq!(stub.missing_count, 0);

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
