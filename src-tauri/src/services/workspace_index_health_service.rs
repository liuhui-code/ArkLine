use crate::models::workspace::WorkspaceIndexHealth;
use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_resume_service::load_resume_tasks;

pub fn get_workspace_index_health(
    root_path: &str,
    index_manager: &WorkspaceIndexManagerRuntime,
) -> Result<WorkspaceIndexHealth, String> {
    let diagnostics = inspect_workspace_index(root_path)?;
    let queue_pressure = index_manager.get_queue_pressure(root_path)?;
    let status = health_status(&diagnostics.status, diagnostics.sdk_symbol_count);
    let has_resume_tasks = !load_resume_tasks(root_path)?.is_empty();
    let repair_actions = repair_actions_for_status(
        status,
        diagnostics.unresolved_import_count,
        diagnostics.parser_error_count,
        diagnostics.active_sdk_path.is_some(),
        has_resume_tasks,
    );

    Ok(WorkspaceIndexHealth {
        root_path: diagnostics.root_path,
        status: status.to_string(),
        file_count: diagnostics.file_count,
        symbol_count: diagnostics.symbol_count,
        reference_count: diagnostics.stub_declaration_count,
        sdk_api_count: diagnostics.sdk_symbol_count,
        unresolved_import_count: diagnostics.unresolved_import_count,
        parser_failure_count: diagnostics.parser_error_count,
        queue_pressure,
        repair_actions,
    })
}

fn health_status(index_status: &str, sdk_symbol_count: i64) -> &'static str {
    match index_status {
        "failed" => "failed",
        "stale" => "stale",
        "partial" => "partial",
        "ready" if sdk_symbol_count == 0 => "missingSdk",
        "ready" => "healthy",
        _ => "stale",
    }
}

fn repair_actions_for_status(
    status: &str,
    unresolved_import_count: i64,
    parser_error_count: i64,
    has_active_sdk: bool,
    has_resume_tasks: bool,
) -> Vec<String> {
    let mut actions = Vec::new();
    match status {
        "missingSdk" if has_active_sdk => actions.push("rebuildSdkIndex".to_string()),
        "missingSdk" => actions.push("configureSdk".to_string()),
        "failed" | "stale" | "partial" => actions.push("rebuildProjectIndex".to_string()),
        _ => {}
    }
    if has_resume_tasks {
        actions.push("resumeIndexing".to_string());
    }
    if unresolved_import_count > 0 {
        actions.push("inspectUnresolvedImports".to_string());
    }
    if parser_error_count > 0 {
        actions.push("inspectParserFailures".to_string());
    }
    actions.sort();
    actions.dedup();
    actions
}
