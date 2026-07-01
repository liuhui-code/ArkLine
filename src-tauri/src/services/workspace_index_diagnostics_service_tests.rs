use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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
