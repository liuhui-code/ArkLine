use crate::services::workspace_index_cache_path_service::{
    catalog_cache_path, normalized_root_key, sqlite_catalog_cache_path,
};

#[test]
fn workspace_index_cache_paths_use_stable_arkline_index_names() {
    let root = "/workspace/project";

    assert_eq!(
        catalog_cache_path(root).to_string_lossy(),
        "/workspace/project/.arkline/index/workspace-catalog.json"
    );
    assert_eq!(
        sqlite_catalog_cache_path(root).to_string_lossy(),
        "/workspace/project/.arkline/index/workspace-catalog.sqlite"
    );
}

#[test]
fn normalized_root_key_uses_index_path_separator() {
    assert_eq!(
        normalized_root_key("/workspace/project"),
        "\\workspace\\project"
    );
}
