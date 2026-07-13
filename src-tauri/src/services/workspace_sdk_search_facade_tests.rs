use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_index_facade_service::query_facade_search_everywhere_with_readiness;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-sdk-search-{name}-{suffix}"))
}

fn search_everywhere_items(
    runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
) -> Vec<WorkspaceSearchCandidate> {
    query_facade_search_everywhere_with_readiness(
        runtime,
        root_path,
        query,
        WorkspaceIndexQueryScope::All,
        8,
    )
    .unwrap()
    .items
}

#[test]
fn sdk_switch_exposes_only_active_sdk_candidates() {
    let workspace = unique_temp_dir("active-sdk-switch");
    let old_sdk_root = workspace.join("old-openharmony");
    let new_sdk_root = workspace.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class LegacyOnly {\n  oldWidth(value: Length): LegacyOnly;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class CurrentOnly {\n  currentWidth(value: Length): CurrentOnly;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    index_workspace_sdk_symbols(&workspace_path, &old_sdk_path, "old-sdk").unwrap();
    index_workspace_sdk_symbols(&workspace_path, &new_sdk_path, "new-sdk").unwrap();
    let old_matches = search_everywhere_items(&runtime, &workspace_path, "oldWidth");
    let current_matches = search_everywhere_items(&runtime, &workspace_path, "currentWidth");

    assert!(old_matches
        .iter()
        .all(|candidate| candidate.source != "api"));
    assert!(current_matches
        .iter()
        .any(|candidate| { candidate.source == "api" && candidate.title == "currentWidth" }));

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn search_everywhere_includes_indexed_sdk_api_symbols() {
    let workspace = unique_temp_dir("search-everywhere");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::create_dir_all(sdk_root.join("toolchains")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let matches = search_everywhere_items(&runtime, &workspace_path, "width");

    assert!(matches
        .iter()
        .any(|candidate| candidate.source == "api" && candidate.title == "width"));

    fs::remove_dir_all(workspace).unwrap();
}
