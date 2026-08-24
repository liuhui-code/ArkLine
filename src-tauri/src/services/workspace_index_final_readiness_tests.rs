use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_facade_service::query_facade_search_everywhere_with_readiness;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn drain_index_pipeline(
    manager: &WorkspaceIndexManagerRuntime,
    runtime: &WorkspaceIndexRuntime,
) -> bool {
    for _ in 0..16 {
        if manager
            .drain_index_task_results(runtime)
            .expect("index tasks should run")
            .is_empty()
        {
            return true;
        }
    }
    false
}

#[test]
fn completed_background_index_makes_project_symbols_ready_without_an_sdk_index() {
    let root = unique_temp_dir("workspace-index-final-readiness");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Home.ets"),
        "class HomeController {\n  openHome() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let reached_idle = drain_index_pipeline(&manager, &runtime);
    let envelope = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "HomeController",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert!(
        reached_idle,
        "index pipeline should drain its continuations"
    );
    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(envelope.readiness.reason, None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn completed_background_index_reports_parser_failures_instead_of_pending() {
    let root = unique_temp_dir("workspace-index-degraded-readiness");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Broken.ets"),
        "struct Broken {\n  build() {\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    assert!(drain_index_pipeline(&manager, &runtime));
    let envelope = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "Broken",
        WorkspaceIndexQueryScope::Symbols,
        8,
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert_eq!(
        envelope.readiness.reason.as_deref(),
        Some("Project indexing completed with 1 parser error; results for affected files may be incomplete")
    );

    fs::remove_dir_all(root).unwrap();
}
