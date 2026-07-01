use std::fs;
use std::path::{Path, PathBuf};

use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

pub fn clear_workspace_index(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
) -> Result<(), String> {
    let root = Path::new(root_path);
    if !root.is_dir() {
        return Err(format!("Workspace root does not exist: {root_path}"));
    }

    index_runtime.clear_workspace_index_state(root_path)?;
    let index_dir = workspace_index_dir(root_path);
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir).map_err(|error| error.to_string())?;
    }
    migrate_workspace_index_schema(root_path)
}

pub fn rebuild_workspace_index(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
) -> Result<(), String> {
    clear_workspace_index(index_runtime, root_path)?;
    index_runtime.refresh_workspace_index(root_path)?;
    Ok(())
}

fn workspace_index_dir(root_path: &str) -> PathBuf {
    Path::new(root_path).join(".arkline").join("index")
}
