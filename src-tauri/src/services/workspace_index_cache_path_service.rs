use std::path::{Path, PathBuf};

pub(crate) fn catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.json")
}

pub(crate) fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

pub(crate) fn normalized_root_key(root_path: &str) -> String {
    root_path.replace('/', "\\")
}
