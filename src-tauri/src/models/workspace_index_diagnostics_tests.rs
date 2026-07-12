use crate::models::workspace_index_diagnostics::{
    WorkspaceIndexDiagnostics, WorkspaceIndexQueuePressure, WorkspaceIndexSchemaVersionAction,
};

#[test]
fn workspace_index_diagnostics_models_serialize_with_camel_case_contract() {
    let diagnostics = WorkspaceIndexDiagnostics {
        root_path: "/workspace".to_string(),
        status: "ready".to_string(),
        schema_versions: [("catalog".to_string(), 1)].into_iter().collect(),
        schema_version_actions: vec![WorkspaceIndexSchemaVersionAction {
            domain: "catalog".to_string(),
            expected_version: 1,
            persisted_version: Some(1),
            status: "compatible".to_string(),
        }],
        file_count: 1,
        symbol_count: 2,
        content_line_count: 3,
        fingerprint_count: 1,
        stub_file_count: 1,
        stub_declaration_count: 2,
        dependency_edge_count: 0,
        unresolved_import_count: 0,
        parser_error_count: 0,
        stale_generation_count: 0,
        sdk_symbol_count: 0,
        discovery_status: None,
        discovered_file_count: 0,
        discovery_excluded_count: 0,
        discovery_has_more: false,
        db_size_bytes: 0,
        queue_pressure: WorkspaceIndexQueuePressure {
            root_path: "/workspace".to_string(),
            pending_task_count: 0,
            workspace_pending_task_count: 0,
            highest_priority: None,
            highest_priority_task_kind: None,
        },
        active_sdk_path: None,
        active_sdk_version: None,
        last_error: None,
        last_explain_status: None,
        repair_actions: Vec::new(),
        parser_failures: Vec::new(),
        unresolved_imports: Vec::new(),
        recent_events: Vec::new(),
        timeline: Vec::new(),
    };

    let json = serde_json::to_string(&diagnostics).unwrap();

    assert!(json.contains("\"rootPath\""));
    assert!(json.contains("\"schemaVersionActions\""));
    assert!(json.contains("\"expectedVersion\""));
    assert!(!json.contains("schema_version_actions"));
}
