use std::fs;

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_task_journal_service::store_task_status;
use crate::services::workspace_index_test_fixture_service::create_empty_workspace;

#[test]
fn diagnostics_summarize_retry_backoff_events() {
    let root = create_empty_workspace("diagnostics-retry-backoff");
    let root_path = root.to_string_lossy().to_string();

    store_task_status(&root_path, &failed_status(&root_path, 1)).unwrap();
    store_task_status(&root_path, &failed_status(&root_path, 2)).unwrap();

    let diagnostics = inspect_workspace_index(&root_path).unwrap();

    assert_eq!(diagnostics.retry_backoff_count, 1);
    assert!(diagnostics
        .latest_retry_backoff
        .as_deref()
        .unwrap_or_default()
        .contains("recommended retry delay 2000ms"));
    fs::remove_dir_all(root).unwrap();
}

fn failed_status(root_path: &str, generation: u64) -> WorkspaceIndexTaskStatus {
    WorkspaceIndexTaskStatus {
        task_id: format!("{generation}:changed-paths"),
        root_path: root_path.replace('/', "\\"),
        kind: "changed-paths".to_string(),
        status: "failed".to_string(),
        reason: "watcher".to_string(),
        generation,
        progress_current: 1,
        progress_total: 1,
        target_paths: Vec::new(),
        target_path_count: None,
        started_at: Some(100),
        last_heartbeat_at: Some(200),
        stalled: false,
        finished_at: Some(200),
        symbol_count: None,
        message: None,
        error: Some("index failed".to_string()),
    }
}
