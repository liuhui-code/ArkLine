use crate::services::workspace_text_search_cancellation_service::{
    is_text_search_generation_stale, WorkspaceTextSearchCancellationRuntime,
    WorkspaceTextSearchGeneration,
};

#[test]
fn newer_generation_marks_previous_text_search_stale() {
    let generation = WorkspaceTextSearchGeneration {
        requested_generation: 4,
        latest_generation: 5,
    };

    assert!(generation.is_stale());
    assert!(is_text_search_generation_stale(4, 5));
}

#[test]
fn same_or_older_generation_keeps_text_search_active() {
    assert!(!is_text_search_generation_stale(4, 4));
    assert!(!is_text_search_generation_stale(4, 3));
}

#[test]
fn runtime_marks_previous_workspace_search_stale_after_newer_generation_registers() {
    let runtime = WorkspaceTextSearchCancellationRuntime::default();

    runtime.register_generation("/workspace", 10).unwrap();
    assert!(!runtime.is_generation_stale("/workspace", 10).unwrap());

    runtime.register_generation("/workspace", 11).unwrap();
    assert!(runtime.is_generation_stale("/workspace", 10).unwrap());
    assert!(!runtime.is_generation_stale("/workspace", 11).unwrap());
}

#[test]
fn runtime_keeps_workspace_generations_independent() {
    let runtime = WorkspaceTextSearchCancellationRuntime::default();

    runtime.register_generation("/workspace-a", 2).unwrap();
    runtime.register_generation("/workspace-b", 9).unwrap();

    assert!(!runtime.is_generation_stale("/workspace-a", 2).unwrap());
    assert!(!runtime.is_generation_stale("/workspace-b", 9).unwrap());
}
