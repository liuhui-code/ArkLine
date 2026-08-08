use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_index_worker_budget_service::{
    budget_deep_layer_paths, budget_deep_layer_paths_with_ui_activity, continuation_yield_message,
    WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET, WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET,
};

#[test]
fn background_deep_layer_paths_are_limited_and_deferred() {
    let paths = paths(WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 2);

    let budgeted = budget_deep_layer_paths(WorkspaceIndexTaskPriority::Background, paths);

    assert_eq!(
        budgeted.selected_paths.len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET
    );
    assert_eq!(budgeted.deferred_paths.len(), 2);
}

#[test]
fn foreground_deep_layer_paths_are_not_limited() {
    let paths = paths(WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 2);

    let budgeted = budget_deep_layer_paths(WorkspaceIndexTaskPriority::ForegroundNavigation, paths);

    assert_eq!(
        budgeted.selected_paths.len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 2
    );
    assert!(budgeted.deferred_paths.is_empty());
}

#[test]
fn ui_activity_lowers_background_deep_layer_budget() {
    let paths = paths(WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET);

    let budgeted = budget_deep_layer_paths_with_ui_activity(
        WorkspaceIndexTaskPriority::Background,
        paths,
        true,
    );

    assert_eq!(
        budgeted.selected_paths.len(),
        WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET
    );
    assert_eq!(
        budgeted.deferred_paths.len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET - WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET
    );
}

#[test]
fn ui_activity_does_not_limit_foreground_navigation() {
    let paths = paths(WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 2);

    let budgeted = budget_deep_layer_paths_with_ui_activity(
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        paths,
        true,
    );

    assert_eq!(
        budgeted.selected_paths.len(),
        WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET + 2
    );
    assert!(budgeted.deferred_paths.is_empty());
}

#[test]
fn continuation_yield_message_reports_background_deferrals() {
    let message = continuation_yield_message("deep-layer", 128, 3);

    assert!(message.contains("128 file(s)"));
    assert!(message.contains("3 file(s) deferred"));
    assert!(message.contains("background budget"));
}

#[test]
fn continuation_yield_message_keeps_legacy_text_without_deferrals() {
    assert_eq!(
        continuation_yield_message("file-layer", 128, 0),
        "Full refresh file-layer continuation yielded"
    );
}

fn paths(count: usize) -> Vec<String> {
    (0..count).map(|index| format!("File{index}.ets")).collect()
}
