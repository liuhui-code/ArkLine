use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

pub const WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET: usize = 128;
pub const WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexBudgetedPaths {
    pub selected_paths: Vec<String>,
    pub deferred_paths: Vec<String>,
}

#[allow(dead_code)]
pub fn budget_deep_layer_paths(
    priority: WorkspaceIndexTaskPriority,
    paths: Vec<String>,
) -> WorkspaceIndexBudgetedPaths {
    budget_deep_layer_paths_with_ui_activity(priority, paths, false)
}

pub fn budget_deep_layer_paths_with_ui_activity(
    priority: WorkspaceIndexTaskPriority,
    paths: Vec<String>,
    ui_latency_sensitive: bool,
) -> WorkspaceIndexBudgetedPaths {
    let budget = effective_deep_layer_path_budget(priority, ui_latency_sensitive);
    if paths.len() <= budget {
        return WorkspaceIndexBudgetedPaths {
            selected_paths: paths,
            deferred_paths: Vec::new(),
        };
    }

    let mut selected_paths = paths;
    let deferred_paths = selected_paths.split_off(budget);
    WorkspaceIndexBudgetedPaths {
        selected_paths,
        deferred_paths,
    }
}

pub fn effective_deep_layer_path_budget(
    priority: WorkspaceIndexTaskPriority,
    ui_latency_sensitive: bool,
) -> usize {
    if priority != WorkspaceIndexTaskPriority::Background {
        return usize::MAX;
    }
    if ui_latency_sensitive {
        return WORKSPACE_INDEX_UI_ACTIVE_DEEP_PATH_BUDGET;
    }
    WORKSPACE_INDEX_BACKGROUND_DEEP_PATH_BUDGET
}

pub fn continuation_yield_message(
    phase_label: &str,
    processed_count: usize,
    deferred_count: usize,
) -> String {
    if deferred_count == 0 {
        return format!("Full refresh {phase_label} continuation yielded");
    }

    format!(
        "Full refresh {phase_label} yielded after {processed_count} file(s); {deferred_count} file(s) deferred by background budget"
    )
}
