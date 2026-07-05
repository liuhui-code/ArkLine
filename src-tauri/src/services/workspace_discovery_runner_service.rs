use std::path::Path;

use crate::services::workspace_discovery_service::{
    discover_workspace_chunk, WorkspaceDiscoveryChunk, WorkspaceDiscoveryCursor,
};
use crate::services::workspace_discovery_store_service::{
    count_discovered_files, replace_discovered_file_chunk, update_discovery_state,
    WorkspaceDiscoveryState,
};

pub fn run_workspace_discovery_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
    generation: i64,
) -> Result<WorkspaceDiscoveryChunk, String> {
    let chunk = discover_workspace_chunk(root_path, cursor, limit)?;
    let root_key = root_path.to_string_lossy().to_string();

    replace_discovered_file_chunk(&root_key, generation, &chunk.files)?;
    let discovered_count = count_discovered_files(&root_key)?;
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_key,
        generation,
        status: if chunk.has_more {
            "running".to_string()
        } else {
            "ready".to_string()
        },
        discovered_count,
        excluded_count: chunk.excluded_count,
        cursor: chunk.cursor.clone(),
        error: None,
    })?;

    Ok(chunk)
}
