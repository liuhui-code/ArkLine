use std::time::Duration;

use crate::services::workspace_index_performance_gate_service::{
    evaluate_deep_layer_performance, performance_timeline_item,
    record_deep_layer_performance_report, samples_from_stub_profile,
    WorkspaceIndexPerfGateThresholds, WorkspaceIndexStageSample,
};
use crate::services::workspace_stub_index_service::WorkspaceStubIndexProfile;

#[test]
fn reports_slowest_stage_and_threshold_violation() {
    let report = evaluate_deep_layer_performance(
        vec![
            sample("generated", "stubParse", 40, 512, Some(0)),
            sample("generated", "referenceRefresh", 180, 512, Some(0)),
        ],
        WorkspaceIndexPerfGateThresholds {
            foreground_ready_ms: 500,
            deep_tick_ms: 250,
            stage_ms: 100,
        },
    );

    assert_eq!(report.sample_count, 2);
    assert_eq!(report.slowest_stage.as_deref(), Some("referenceRefresh"));
    assert_eq!(report.slowest_duration_ms, 180);
    assert_eq!(report.violations.len(), 1);
    assert_eq!(report.violations[0].stage, "referenceRefresh");
    assert!(report
        .evidence
        .iter()
        .any(|line| line.contains("stage=referenceRefresh")));
}

#[test]
fn converts_stub_refresh_profile_into_deep_layer_samples() {
    let profile = WorkspaceStubIndexProfile {
        delete_duration: Duration::from_millis(5),
        insert_duration: Duration::from_millis(30),
        insert_parse_duration: Duration::from_millis(12),
        insert_write_duration: Duration::from_millis(18),
        graph_duration: Duration::from_millis(20),
        resolve_duration: Duration::from_millis(70),
        reference_duration: Duration::from_millis(90),
    };

    let samples = samples_from_stub_profile("generated", 1, 256, &profile);

    assert_eq!(
        samples
            .iter()
            .map(|sample| sample.stage.as_str())
            .collect::<Vec<_>>(),
        vec![
            "stubDelete",
            "stubParse",
            "stubWrite",
            "dependencyGraph",
            "symbolResolution",
            "referenceRefresh"
        ]
    );
    assert!(samples
        .iter()
        .all(|sample| sample.source == "generated" && sample.path_count == 256));
}

#[test]
fn keeps_fixture_source_in_evidence_for_generated_and_project_comparison() {
    let report = evaluate_deep_layer_performance(
        vec![
            sample("generated", "symbolResolution", 80, 128, Some(2)),
            sample("project", "symbolResolution", 220, 128, Some(2)),
        ],
        WorkspaceIndexPerfGateThresholds::default(),
    );

    assert_eq!(report.slowest_source.as_deref(), Some("project"));
    assert!(report
        .evidence
        .iter()
        .any(|line| line.contains("source=project")));
}

#[test]
fn records_performance_gate_report_as_unified_index_event() {
    let root = crate::services::workspace_index_test_fixture_service::unique_temp_dir(
        "performance-gate-event",
    );
    std::fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let report = evaluate_deep_layer_performance(
        vec![sample("project", "referenceRefresh", 400, 128, Some(3))],
        WorkspaceIndexPerfGateThresholds {
            foreground_ready_ms: 500,
            deep_tick_ms: 1_000,
            stage_ms: 250,
        },
    );

    let event = record_deep_layer_performance_report(&root_path, &report).unwrap();
    let timeline = performance_timeline_item(&event);

    assert_eq!(event.scope, "performance");
    assert_eq!(event.kind, "deep-layer");
    assert_eq!(event.phase, "threshold");
    assert_eq!(event.severity, "warning");
    assert!(event.payload_json.contains("referenceRefresh"));
    assert!(timeline.message.contains("slowest referenceRefresh"));
    std::fs::remove_dir_all(root).unwrap();
}

fn sample(
    source: &str,
    stage: &str,
    duration_ms: u64,
    path_count: usize,
    chunk_index: Option<usize>,
) -> WorkspaceIndexStageSample {
    WorkspaceIndexStageSample {
        source: source.to_string(),
        stage: stage.to_string(),
        duration_ms,
        path_count,
        chunk_index,
    }
}
