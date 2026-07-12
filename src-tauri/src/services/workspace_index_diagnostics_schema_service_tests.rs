use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn reports_schema_rebuild_repair_action_for_incompatible_versions() {
    let root = unique_temp_dir("workspace-index-diagnostics-schema-rebuild");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Index.ets"), "struct Index {}\n").unwrap();
    let sdk_dir = root.join("openharmony").join("ets");
    fs::create_dir_all(&sdk_dir).unwrap();
    fs::write(
        sdk_dir.join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let sdk_path = root.join("openharmony").to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_path, "test-sdk").unwrap();
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    connection
        .execute(
            "update workspace_index_schema_versions
             set version = 0
             where domain = 'content'",
            [],
        )
        .unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert!(diagnostics
        .schema_version_actions
        .iter()
        .any(|action| { action.domain == "content" && action.status == "needs-rebuild" }));
    assert!(diagnostics
        .repair_actions
        .iter()
        .any(|action| action == "rebuildProjectIndex"));

    fs::remove_dir_all(root).unwrap();
}
