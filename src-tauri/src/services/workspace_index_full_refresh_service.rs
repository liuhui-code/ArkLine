use std::collections::HashSet;
use std::path::Path;

use crate::models::workspace::WorkspaceIndexRefreshResult;
use crate::services::workspace_index_cancellation_service::WorkspaceIndexCancellationToken;
use crate::services::workspace_index_chunk_service::{
    plan_refresh_continuation, WorkspaceIndexChunkProgress, WorkspaceIndexRefreshContinuation,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_service::scan_workspace;

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceIndexFullRefreshOutcome {
    pub result: WorkspaceIndexRefreshResult,
    pub continuation: Option<WorkspaceIndexRefreshContinuation<String>>,
    pub progress: Option<WorkspaceIndexChunkProgress>,
}

pub fn refresh_workspace_index_in_chunks(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    chunk_size: usize,
    token: &WorkspaceIndexCancellationToken,
) -> Result<Option<WorkspaceIndexFullRefreshOutcome>, String> {
    let previous_state = index_runtime.get_index_state(root_path)?;
    let previous_paths = previous_state
        .file_paths
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let snapshot = scan_workspace(Path::new(root_path))?;
    let mut state = previous_state;
    if previous_paths.is_empty() {
        if token.is_cancelled() {
            return Ok(None);
        }
        state = index_runtime.index_workspace_snapshot_for_open(&snapshot)?;
    }

    let current_paths = snapshot
        .files
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    let mut added_or_changed = current_paths.iter().cloned().collect::<Vec<_>>();
    let mut removed_paths = previous_paths
        .difference(&current_paths)
        .cloned()
        .collect::<Vec<_>>();
    added_or_changed.sort();
    removed_paths.sort();

    let mut continuation =
        plan_refresh_continuation(root_path, token.generation(), added_or_changed, chunk_size);
    let mut added_paths = Vec::new();
    let mut progress = None;
    if let Some(chunk) = continuation.pop_next_chunk() {
        if token.is_cancelled() {
            return Ok(None);
        }
        progress = Some(chunk.progress);
        state = index_runtime.update_workspace_file_symbol_layer(root_path, &chunk.paths, &[])?;
        added_paths.extend(chunk.paths);
    }
    if !removed_paths.is_empty() {
        if token.is_cancelled() {
            return Ok(None);
        }
        state = index_runtime.update_workspace_files(root_path, &[], &removed_paths)?;
    }
    added_paths.sort();
    added_paths.dedup();
    Ok(Some(WorkspaceIndexFullRefreshOutcome {
        result: WorkspaceIndexRefreshResult {
            state,
            changed: !added_paths.is_empty() || !removed_paths.is_empty(),
            added_paths,
            removed_paths,
        },
        continuation: (!continuation.is_complete()).then_some(continuation),
        progress,
    }))
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
