pub struct WorkspaceIndexRepairActionInput {
    pub status: String,
    pub unresolved_import_count: i64,
    pub parser_error_count: i64,
    pub has_active_sdk: bool,
    pub has_resume_tasks: bool,
    pub schema_needs_rebuild: bool,
}

pub fn workspace_index_repair_actions(input: &WorkspaceIndexRepairActionInput) -> Vec<String> {
    let mut actions = Vec::new();
    match input.status.as_str() {
        "missingSdk" if input.has_active_sdk => actions.push("rebuildSdkIndex".to_string()),
        "missingSdk" => actions.push("configureSdk".to_string()),
        "failed" | "stale" | "partial" => actions.push("rebuildProjectIndex".to_string()),
        _ => {}
    }
    if input.schema_needs_rebuild {
        actions.push("rebuildProjectIndex".to_string());
    }
    if input.has_resume_tasks {
        actions.push("resumeIndexing".to_string());
    }
    if input.unresolved_import_count > 0 {
        actions.push("inspectUnresolvedImports".to_string());
    }
    if input.parser_error_count > 0 {
        actions.push("inspectParserFailures".to_string());
    }
    actions.sort();
    actions.dedup();
    actions
}

pub fn workspace_index_health_status(index_status: &str, sdk_symbol_count: i64) -> &'static str {
    match index_status {
        "failed" => "failed",
        "stale" => "stale",
        "partial" => "partial",
        "ready" if sdk_symbol_count == 0 => "missingSdk",
        "ready" => "healthy",
        _ => "stale",
    }
}
