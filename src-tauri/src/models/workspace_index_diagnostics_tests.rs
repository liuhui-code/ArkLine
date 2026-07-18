use crate::models::workspace_index_diagnostics::{
    WorkspaceIndexDiagnostics, WorkspaceIndexFreshnessLayerSummary, WorkspaceIndexQueuePressure,
    WorkspaceIndexSchemaVersionAction, WorkspaceIndexerHostSnapshot,
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
        freshness_layers: vec![WorkspaceIndexFreshnessLayerSummary {
            layer: "content".to_string(),
            ready_count: 1,
            stale_count: 0,
            missing_count: 0,
            expected_version: 1,
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
        writer_metrics: Default::default(),
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
        retry_backoff_count: 0,
        latest_retry_backoff: None,
        repair_actions: Vec::new(),
        parser_failures: Vec::new(),
        unresolved_imports: Vec::new(),
        recent_events: Vec::new(),
        timeline: Vec::new(),
        indexer_host: Some(WorkspaceIndexerHostSnapshot {
            enabled: true,
            status: "running".to_string(),
            process_id: Some(42),
            discovery_process_id: Some(42),
            content_process_id: Some(43),
            stub_process_id: Some(44),
            discovery_writer_metrics: None,
            content_writer_metrics: None,
            stub_writer_metrics: None,
            completed_discovery_chunks: 3,
            completed_content_refresh_chunks: 4,
            cancelled_content_refresh_chunks: 1,
            completed_stub_refresh_chunks: 2,
            cancelled_stub_refresh_chunks: 1,
            fallback_count: 0,
            restart_count: 1,
            consecutive_failure_count: 2,
            backoff_remaining_ms: Some(250),
            last_error: None,
        }),
    };

    let json = serde_json::to_string(&diagnostics).unwrap();

    assert!(json.contains("\"rootPath\""));
    assert!(json.contains("\"schemaVersionActions\""));
    assert!(json.contains("\"freshnessLayers\""));
    assert!(json.contains("\"retryBackoffCount\""));
    assert!(json.contains("\"expectedVersion\""));
    assert!(json.contains("\"indexerHost\""));
    assert!(json.contains("\"completedDiscoveryChunks\""));
    assert!(json.contains("\"backoffRemainingMs\""));
    assert!(json.contains("\"writerMetrics\""));
    assert!(!json.contains("schema_version_actions"));
}
