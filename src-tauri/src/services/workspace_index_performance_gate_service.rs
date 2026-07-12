#![allow(dead_code)]

use crate::models::workspace::{WorkspaceIndexEvent, WorkspaceIndexTimelineItem};
use crate::services::workspace_index_event_service::store_index_event;
use crate::services::workspace_index_task_status_service::current_time_millis;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexStageSample {
    pub source: String,
    pub stage: String,
    pub duration_ms: u64,
    pub path_count: usize,
    pub chunk_index: Option<usize>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkspaceIndexPerfGateThresholds {
    pub foreground_ready_ms: u64,
    pub deep_tick_ms: u64,
    pub stage_ms: u64,
}

impl Default for WorkspaceIndexPerfGateThresholds {
    fn default() -> Self {
        Self {
            foreground_ready_ms: 500,
            deep_tick_ms: 1_000,
            stage_ms: 250,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexPerfViolation {
    pub source: String,
    pub stage: String,
    pub duration_ms: u64,
    pub threshold_ms: u64,
    pub path_count: usize,
    pub chunk_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexPerfGateReport {
    pub sample_count: usize,
    pub slowest_source: Option<String>,
    pub slowest_stage: Option<String>,
    pub slowest_duration_ms: u64,
    pub violations: Vec<WorkspaceIndexPerfViolation>,
    pub evidence: Vec<String>,
}

pub fn evaluate_deep_layer_performance(
    samples: Vec<WorkspaceIndexStageSample>,
    thresholds: WorkspaceIndexPerfGateThresholds,
) -> WorkspaceIndexPerfGateReport {
    let slowest = samples.iter().max_by_key(|sample| sample.duration_ms);
    let violations = samples
        .iter()
        .filter(|sample| sample.duration_ms > threshold_for_stage(sample, thresholds))
        .map(|sample| violation(sample, threshold_for_stage(sample, thresholds)))
        .collect::<Vec<_>>();
    let evidence = samples.iter().map(evidence_line).collect::<Vec<_>>();

    WorkspaceIndexPerfGateReport {
        sample_count: samples.len(),
        slowest_source: slowest.map(|sample| sample.source.clone()),
        slowest_stage: slowest.map(|sample| sample.stage.clone()),
        slowest_duration_ms: slowest.map(|sample| sample.duration_ms).unwrap_or_default(),
        violations,
        evidence,
    }
}

pub fn record_deep_layer_performance_report(
    root_path: &str,
    report: &WorkspaceIndexPerfGateReport,
) -> Result<WorkspaceIndexEvent, String> {
    let event = performance_event(root_path, report);
    store_index_event(root_path, &event)?;
    Ok(event)
}

pub fn performance_timeline_item(event: &WorkspaceIndexEvent) -> WorkspaceIndexTimelineItem {
    WorkspaceIndexTimelineItem {
        scope: event.scope.clone(),
        kind: event.kind.clone(),
        phase: event.phase.clone(),
        title: format!("{} {}", event.kind, event.phase),
        severity: event.severity.clone(),
        message: event.message.clone(),
        task_id: event.task_id.clone(),
        generation: event.generation,
        occurred_at: event.created_at,
        duration_ms: None,
    }
}

#[cfg(test)]
pub fn samples_from_stub_profile(
    source: &str,
    chunk_index: usize,
    path_count: usize,
    profile: &crate::services::workspace_stub_index_service::WorkspaceStubIndexProfile,
) -> Vec<WorkspaceIndexStageSample> {
    vec![
        sample(
            source,
            "stubDelete",
            profile.delete_duration,
            path_count,
            chunk_index,
        ),
        sample(
            source,
            "stubParse",
            profile.insert_parse_duration,
            path_count,
            chunk_index,
        ),
        sample(
            source,
            "stubWrite",
            profile.insert_write_duration,
            path_count,
            chunk_index,
        ),
        sample(
            source,
            "dependencyGraph",
            profile.graph_duration,
            path_count,
            chunk_index,
        ),
        sample(
            source,
            "symbolResolution",
            profile.resolve_duration,
            path_count,
            chunk_index,
        ),
        sample(
            source,
            "referenceRefresh",
            profile.reference_duration,
            path_count,
            chunk_index,
        ),
    ]
}

#[cfg(test)]
pub fn samples_from_reference_refresh_profile(
    source: &str,
    chunk_index: usize,
    profile: &crate::services::workspace_reference_index_service::WorkspaceReferenceRefreshProfile,
) -> Vec<WorkspaceIndexStageSample> {
    vec![
        reference_sample(
            source,
            "referenceDelete",
            profile.delete_duration,
            profile.affected_path_count,
            chunk_index,
            None,
        ),
        reference_sample(
            source,
            "referenceContent",
            profile.content_duration,
            profile.content_count,
            chunk_index,
            Some(format!("skippedContent={}", profile.skipped_content_count)),
        ),
        reference_sample(
            source,
            "referenceMemberContext",
            profile.member_context_duration,
            profile.content_count,
            chunk_index,
            Some(format!("loaded={}", profile.member_context_loaded)),
        ),
        reference_sample(
            source,
            "referenceIndex",
            profile.index_duration,
            profile.content_count,
            chunk_index,
            None,
        ),
    ]
}

#[cfg(test)]
fn sample(
    source: &str,
    stage: &str,
    duration: std::time::Duration,
    path_count: usize,
    chunk_index: usize,
) -> WorkspaceIndexStageSample {
    WorkspaceIndexStageSample {
        source: source.to_string(),
        stage: stage.to_string(),
        duration_ms: duration.as_millis() as u64,
        path_count,
        chunk_index: Some(chunk_index),
        detail: None,
    }
}

#[cfg(test)]
fn reference_sample(
    source: &str,
    stage: &str,
    duration: std::time::Duration,
    path_count: usize,
    chunk_index: usize,
    detail: Option<String>,
) -> WorkspaceIndexStageSample {
    WorkspaceIndexStageSample {
        source: source.to_string(),
        stage: stage.to_string(),
        duration_ms: duration.as_millis() as u64,
        path_count,
        chunk_index: Some(chunk_index),
        detail,
    }
}

fn threshold_for_stage(
    sample: &WorkspaceIndexStageSample,
    thresholds: WorkspaceIndexPerfGateThresholds,
) -> u64 {
    match sample.stage.as_str() {
        "foregroundReady" => thresholds.foreground_ready_ms,
        "deepTick" => thresholds.deep_tick_ms,
        _ => thresholds.stage_ms,
    }
}

fn violation(sample: &WorkspaceIndexStageSample, threshold_ms: u64) -> WorkspaceIndexPerfViolation {
    WorkspaceIndexPerfViolation {
        source: sample.source.clone(),
        stage: sample.stage.clone(),
        duration_ms: sample.duration_ms,
        threshold_ms,
        path_count: sample.path_count,
        chunk_index: sample.chunk_index,
    }
}

fn evidence_line(sample: &WorkspaceIndexStageSample) -> String {
    let chunk = sample
        .chunk_index
        .map(|index| index.to_string())
        .unwrap_or_else(|| "none".to_string());
    let mut line = format!(
        "source={} stage={} durationMs={} pathCount={} chunk={}",
        sample.source, sample.stage, sample.duration_ms, sample.path_count, chunk
    );
    if let Some(detail) = &sample.detail {
        line.push_str(" detail=");
        line.push_str(detail);
    }
    line
}

fn performance_event(
    root_path: &str,
    report: &WorkspaceIndexPerfGateReport,
) -> WorkspaceIndexEvent {
    let created_at = current_time_millis();
    WorkspaceIndexEvent {
        event_id: format!("performance:deep-layer:{created_at}"),
        root_path: root_path.replace('/', "\\"),
        scope: "performance".to_string(),
        kind: "deep-layer".to_string(),
        phase: if report.violations.is_empty() {
            "sampled"
        } else {
            "threshold"
        }
        .to_string(),
        severity: if report.violations.is_empty() {
            "info"
        } else {
            "warning"
        }
        .to_string(),
        message: performance_message(report),
        task_id: None,
        generation: None,
        payload_json: performance_payload(report),
        created_at,
    }
}

fn performance_message(report: &WorkspaceIndexPerfGateReport) -> String {
    let stage = report.slowest_stage.as_deref().unwrap_or("none");
    let source = report.slowest_source.as_deref().unwrap_or("none");
    format!(
        "Deep-layer performance: slowest {stage} from {source} took {}ms; {} violation(s)",
        report.slowest_duration_ms,
        report.violations.len()
    )
}

fn performance_payload(report: &WorkspaceIndexPerfGateReport) -> String {
    let violations = report
        .violations
        .iter()
        .map(|violation| {
            serde_json::json!({
                "source": violation.source,
                "stage": violation.stage,
                "durationMs": violation.duration_ms,
                "thresholdMs": violation.threshold_ms,
                "pathCount": violation.path_count,
                "chunkIndex": violation.chunk_index,
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "sampleCount": report.sample_count,
        "slowestSource": report.slowest_source,
        "slowestStage": report.slowest_stage,
        "slowestDurationMs": report.slowest_duration_ms,
        "violations": violations,
        "evidence": report.evidence,
    })
    .to_string()
}
