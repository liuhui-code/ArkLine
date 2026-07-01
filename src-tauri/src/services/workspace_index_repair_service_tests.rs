use std::fs;

use crate::services::workspace_index_repair_service::{
    inspect_parser_failures, inspect_unresolved_imports, load_active_sdk_repair_target,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::unique_temp_dir;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn inspects_parser_failures() {
    let root = unique_temp_dir("workspace-index-repair-parser");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Broken.ets"), "struct Broken {\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let failures = inspect_parser_failures(&root_path, 20).unwrap();

    assert_eq!(failures.len(), 1);
    assert!(failures[0].path.ends_with("Broken.ets"));
    assert!(failures[0].message.contains("Unclosed block"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn inspects_unresolved_imports() {
    let root = unique_temp_dir("workspace-index-repair-import");
    let source_dir = root.join("entry/src/main/ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "import { Missing } from \"./Missing\";\nstruct Index {}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let imports = inspect_unresolved_imports(&root_path, 20).unwrap();

    assert_eq!(imports.len(), 1);
    assert!(imports[0].from_path.ends_with("Index.ets"));
    assert_eq!(imports[0].source_module, "./Missing");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn loads_active_sdk_repair_target() {
    let root = unique_temp_dir("workspace-index-repair-sdk");
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

    let target = load_active_sdk_repair_target(&root_path)
        .unwrap()
        .expect("active sdk target should be available");

    assert_eq!(target.sdk_path, sdk_path);
    assert_eq!(target.sdk_version, "test-sdk");

    fs::remove_dir_all(root).unwrap();
}
