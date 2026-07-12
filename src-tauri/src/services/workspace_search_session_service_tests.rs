use crate::services::workspace_search_session_service::WorkspaceSearchSessionRuntime;

#[test]
fn marks_previous_generation_stale_after_newer_registers() {
    let runtime = WorkspaceSearchSessionRuntime::default();

    runtime
        .register_generation("/workspace", "searchEverywhere", 10)
        .unwrap();
    runtime
        .register_generation("/workspace", "searchEverywhere", 11)
        .unwrap();

    assert!(runtime
        .is_generation_stale("/workspace", "searchEverywhere", 10)
        .unwrap());
    assert!(!runtime
        .is_generation_stale("/workspace", "searchEverywhere", 11)
        .unwrap());
}

#[test]
fn cancellation_advances_generation_for_the_matching_kind() {
    let runtime = WorkspaceSearchSessionRuntime::default();

    runtime
        .register_generation("/workspace", "text", 3)
        .unwrap();
    runtime.cancel_generation("/workspace", "text", 3).unwrap();

    assert!(runtime
        .is_generation_stale("/workspace", "text", 3)
        .unwrap());
    assert!(!runtime
        .is_generation_stale("/workspace", "searchEverywhere", 3)
        .unwrap());
}

#[test]
fn workspace_generations_are_independent() {
    let runtime = WorkspaceSearchSessionRuntime::default();

    runtime
        .register_generation("/workspace-a", "text", 4)
        .unwrap();
    runtime
        .register_generation("/workspace-b", "text", 5)
        .unwrap();

    assert!(!runtime
        .is_generation_stale("/workspace-a", "text", 4)
        .unwrap());
    assert!(runtime
        .is_generation_stale("/workspace-b", "text", 4)
        .unwrap());
}
