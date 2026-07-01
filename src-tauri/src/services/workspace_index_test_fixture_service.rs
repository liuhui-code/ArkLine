use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-index-{name}-{suffix}"))
}

pub fn create_workspace_source_dir(root: &PathBuf) -> PathBuf {
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    source_dir
}

pub fn create_empty_workspace(name: &str) -> PathBuf {
    let root = unique_temp_dir(name);
    create_workspace_source_dir(&root);
    root
}
