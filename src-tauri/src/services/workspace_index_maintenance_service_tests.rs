use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_cache_path_service::sqlite_catalog_cache_path;
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_maintenance_service::clear_workspace_index;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn clears_persistent_and_in_memory_workspace_index() {
    let root = unique_temp_dir("workspace-index-clear");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"ClearIndex\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    assert!(inspect_workspace_index(&root_path).unwrap().file_count > 0);
    with_workspace_index_writer(&root_path, |connection| {
        connection
            .execute(
                "update workspace_index_schema_versions
                 set version = 0 where domain = 'content'",
                [],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .unwrap();

    clear_workspace_index(&runtime, &root_path).unwrap();
    let diagnostics = inspect_workspace_index(&root_path).unwrap();
    let state = runtime.get_index_state(&root_path).unwrap();

    assert_eq!(diagnostics.file_count, 0);
    assert_eq!(diagnostics.symbol_count, 0);
    assert_eq!(diagnostics.content_line_count, 0);
    assert_eq!(diagnostics.fingerprint_count, 0);
    assert!(state.file_paths.is_empty());
    assert!(sqlite_catalog_cache_path(&root_path).is_file());
    assert!(!diagnostics.schema_versions.is_empty());
    assert!(diagnostics
        .schema_version_actions
        .iter()
        .all(|action| action.status == "compatible"));

    fs::remove_dir_all(root).unwrap();
}
