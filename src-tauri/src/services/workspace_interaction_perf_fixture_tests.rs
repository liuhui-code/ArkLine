use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_index_facade_service::query_facade_text_search_result;
use crate::services::workspace_index_file_readiness_service::get_workspace_index_file_readiness;
use crate::services::workspace_index_query_service::query_workspace_search_everywhere;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_service::scan_workspace;

const OPEN_THRESHOLD_MS: u128 = 800;
const SEARCH_THRESHOLD_MS: u128 = 500;
const TEXT_THRESHOLD_MS: u128 = 500;
const FOREGROUND_THRESHOLD_MS: u128 = 1_000;
const PROGRESS_THRESHOLD_MS: u128 = 1_500;

#[test]
#[ignore = "Run explicitly with ARKLINE_PROFILE_ROOT to profile interaction smoothness"]
fn verifies_real_project_interaction_smoothness() {
    let Some(root_path) = profile_root_path() else {
        eprintln!("ARKLINE_PROFILE_ROOT is not set; skipping interaction smoothness profile");
        return;
    };

    let report = build_interaction_smoothness_report(Path::new(&root_path)).unwrap();
    eprintln!("{}", report.summary());
    if strict_perf_enabled() {
        assert!(
            report.violations().is_empty(),
            "interaction smoothness violations: {:?}",
            report.violations()
        );
    }
}

fn profile_root_path() -> Option<String> {
    std::env::var("ARKLINE_PROFILE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn strict_perf_enabled() -> bool {
    std::env::var("ARKLINE_STRICT_PERF")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[derive(Debug)]
struct InteractionSmoothnessReport {
    root_path: String,
    file_count: usize,
    sampled_file: String,
    search_query: String,
    text_query: String,
    open_lightweight_ms: u128,
    first_file_readiness_ms: u128,
    double_shift_first_result_ms: u128,
    double_shift_result_count: usize,
    text_search_first_batch_ms: u128,
    text_search_match_count: usize,
    foreground_readiness_ms: u128,
    foreground_definition_available: bool,
    progress_evidence_ms: u128,
}

impl InteractionSmoothnessReport {
    fn summary(&self) -> String {
        format!(
            "Interaction smoothness profile\n\
             root: {}\n\
             files: {}\n\
             sampled_file: {}\n\
             search_query: {:?}, text_query: {:?}\n\
             open_lightweight: {}ms\n\
             first_file_readiness: {}ms\n\
             double_shift_first_result: {}ms ({} result(s))\n\
             ctrl_shift_f_first_batch: {}ms ({} match(es))\n\
             foreground_readiness: {}ms (definition_available={})\n\
             progress_evidence: {}ms\n\
             violations: {:?}",
            self.root_path,
            self.file_count,
            self.sampled_file,
            self.search_query,
            self.text_query,
            self.open_lightweight_ms,
            self.first_file_readiness_ms,
            self.double_shift_first_result_ms,
            self.double_shift_result_count,
            self.text_search_first_batch_ms,
            self.text_search_match_count,
            self.foreground_readiness_ms,
            self.foreground_definition_available,
            self.progress_evidence_ms,
            self.violations()
        )
    }

    fn violations(&self) -> Vec<String> {
        let mut violations = Vec::new();
        push_violation(
            &mut violations,
            "open_lightweight",
            self.open_lightweight_ms,
            OPEN_THRESHOLD_MS,
        );
        push_violation(
            &mut violations,
            "double_shift_first_result",
            self.double_shift_first_result_ms,
            SEARCH_THRESHOLD_MS,
        );
        push_violation(
            &mut violations,
            "ctrl_shift_f_first_batch",
            self.text_search_first_batch_ms,
            TEXT_THRESHOLD_MS,
        );
        push_violation(
            &mut violations,
            "foreground_readiness",
            self.foreground_readiness_ms,
            FOREGROUND_THRESHOLD_MS,
        );
        push_violation(
            &mut violations,
            "progress_evidence",
            self.progress_evidence_ms,
            PROGRESS_THRESHOLD_MS,
        );
        violations
    }
}

fn build_interaction_smoothness_report(root: &Path) -> Result<InteractionSmoothnessReport, String> {
    let runtime = WorkspaceIndexRuntime::default();
    let scan_start = Instant::now();
    let snapshot = scan_workspace(root)?;
    let state = runtime.index_workspace_snapshot_for_open(&snapshot)?;
    let open_lightweight = scan_start.elapsed();
    let sampled_file = pick_sample_file(&snapshot.root_path, &state.file_paths)?;
    let text = read_sample_text(&sampled_file)?;
    let search_query = file_stem_query(&sampled_file);
    let text_query = first_searchable_token(&text).unwrap_or_else(|| search_query.clone());

    let readiness_start = Instant::now();
    let first_readiness = get_workspace_index_file_readiness(&snapshot.root_path, &sampled_file)?;
    let first_file_readiness = readiness_start.elapsed();

    let search_start = Instant::now();
    let search_results =
        query_workspace_search_everywhere(&runtime, &snapshot.root_path, &search_query, 20)?;
    let double_shift_first_result = search_start.elapsed();

    let text_start = Instant::now();
    let text_result = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: snapshot.root_path.clone(),
            query: text_query.clone(),
            generation: Some(1),
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 20,
            context_lines: 1,
        },
    )?;
    let text_search_first_batch = text_start.elapsed();

    let foreground_start = Instant::now();
    runtime.update_workspace_files(
        &snapshot.root_path,
        std::slice::from_ref(&sampled_file),
        &[],
    )?;
    let foreground_readiness =
        get_workspace_index_file_readiness(&snapshot.root_path, &sampled_file)?;
    let foreground_duration = foreground_start.elapsed();

    Ok(InteractionSmoothnessReport {
        root_path: snapshot.root_path,
        file_count: state.file_paths.len(),
        sampled_file,
        search_query,
        text_query,
        open_lightweight_ms: duration_ms(open_lightweight),
        first_file_readiness_ms: duration_ms(first_file_readiness),
        double_shift_first_result_ms: duration_ms(double_shift_first_result),
        double_shift_result_count: search_results.len(),
        text_search_first_batch_ms: duration_ms(text_search_first_batch),
        text_search_match_count: text_result.matches.len(),
        foreground_readiness_ms: duration_ms(foreground_duration),
        foreground_definition_available: first_readiness.definition_available
            || foreground_readiness.definition_available,
        progress_evidence_ms: duration_ms(open_lightweight),
    })
}

fn push_violation(violations: &mut Vec<String>, label: &str, actual: u128, limit: u128) {
    if actual > limit {
        violations.push(format!("{label} {actual}ms > {limit}ms"));
    }
}

fn duration_ms(duration: Duration) -> u128 {
    duration.as_millis()
}

fn pick_sample_file(root_path: &str, paths: &[String]) -> Result<String, String> {
    paths
        .iter()
        .map(|path| to_filesystem_path(root_path, path))
        .find(|path| is_source_like(path) && Path::new(path).is_file())
        .or_else(|| {
            paths
                .iter()
                .map(|path| to_filesystem_path(root_path, path))
                .find(|path| Path::new(path).is_file())
        })
        .ok_or_else(|| "Workspace has no readable files to profile".to_string())
}

fn is_source_like(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|value| value.to_str()),
        Some("ets" | "ts" | "tsx" | "js" | "jsx" | "rs" | "java" | "kt" | "swift")
    )
}

fn read_sample_text(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read sampled file {}: {error}",
            PathBuf::from(path).display()
        )
    })
}

fn file_stem_query(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("index")
        .chars()
        .take(24)
        .collect()
}

fn first_searchable_token(text: &str) -> Option<String> {
    text.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .find(|token| token.len() >= 4 && token.chars().any(|character| character.is_alphabetic()))
        .map(|token| token.chars().take(32).collect())
}

fn to_filesystem_path(root_path: &str, indexed_path: &str) -> String {
    if Path::new(indexed_path).exists() {
        return indexed_path.to_string();
    }

    if root_path.contains('/') {
        indexed_path.replace('\\', "/")
    } else {
        indexed_path.replace('/', "\\")
    }
}
