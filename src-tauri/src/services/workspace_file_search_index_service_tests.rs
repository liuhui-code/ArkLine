use crate::services::workspace_file_search_index_service::WorkspaceFileSearchIndex;
use std::time::{Duration, Instant};

#[test]
fn ranks_exact_prefix_contains_and_acronym_matches() {
    let index = WorkspaceFileSearchIndex::new(vec![
        "/workspace/src/MyLogin.ets".to_string(),
        "/workspace/src/LoginPage.ets".to_string(),
        "/workspace/src/Login.ets".to_string(),
        "/workspace/src/LongParserAdapter.ets".to_string(),
    ]);

    let login = index.query("login", 8, "ready");
    let titles = login
        .iter()
        .map(|candidate| candidate.title.as_str())
        .collect::<Vec<_>>();
    assert_eq!(titles, vec!["Login.ets", "LoginPage.ets", "MyLogin.ets"]);

    let acronym = index.query("lpa", 8, "ready");
    assert_eq!(acronym[0].title, "LongParserAdapter.ets");
}

#[test]
fn supports_single_character_file_prefix_queries() {
    let index = WorkspaceFileSearchIndex::new(vec![
        "/workspace/src/About.ets".to_string(),
        "/workspace/src/Index.ets".to_string(),
    ]);

    let result = index.query("a", 8, "partial");

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].title, "About.ets");
    assert_eq!(result[0].freshness, "partial");
}

#[test]
fn supports_directory_qualified_file_queries() {
    let index = WorkspaceFileSearchIndex::new(vec![
        "/workspace/components/Index.ets".to_string(),
        "/workspace/pages/Index.ets".to_string(),
    ]);

    let result = index.query("components/index", 8, "ready");

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].path.as_deref(),
        Some("/workspace/components/Index.ets")
    );
}

#[test]
fn exact_large_catalog_query_scores_only_indexed_candidates() {
    let paths: Vec<String> = (0..20_000)
        .map(|index| format!("/workspace/pages/file-{index:05}.ets"))
        .collect();
    let index = WorkspaceFileSearchIndex::new(paths);

    let result = index.query_with_metrics("file-00000", 20, "ready");

    assert_eq!(result.candidates[0].title, "file-00000.ets");
    assert!(
        result.scored_path_count <= 512,
        "exact indexed query scored {} paths",
        result.scored_path_count
    );
}

#[test]
fn empty_query_returns_a_bounded_catalog_prefix() {
    let index = WorkspaceFileSearchIndex::new(vec![
        "/workspace/src/A.ets".to_string(),
        "/workspace/src/B.ets".to_string(),
        "/workspace/src/C.ets".to_string(),
    ]);

    let result = index.query_with_metrics("", 2, "ready");

    assert_eq!(result.candidates.len(), 2);
    assert_eq!(result.scored_path_count, 0);
}

#[test]
#[ignore = "report-only 100k file search benchmark"]
fn reports_100k_file_search_index_performance() {
    let paths: Vec<String> = (0..100_000)
        .map(|index| {
            format!(
                "/workspace/module-{}/pages/GeneratedPage{index:06}.ets",
                index % 100
            )
        })
        .collect();
    let build_started = Instant::now();
    let index = WorkspaceFileSearchIndex::new(paths);
    let build_duration = build_started.elapsed();
    let queries = [
        "generatedpage099999",
        "generatedpage01",
        "page099",
        "module-42/generatedpage042042",
    ];
    let mut durations = Vec::with_capacity(100);

    for iteration in 0..100 {
        let started = Instant::now();
        let result = index.query_with_metrics(queries[iteration % queries.len()], 50, "ready");
        durations.push(started.elapsed());
        assert!(result.candidates.len() <= 50);
        assert!(result.scored_path_count <= 512);
    }

    durations.sort_unstable();
    let p50 = percentile(&durations, 50);
    let p95 = percentile(&durations, 95);
    let p99 = percentile(&durations, 99);
    eprintln!(
        "100k FileSearchIndex profile: build={build_duration:?}, query_p50={p50:?}, query_p95={p95:?}, query_p99={p99:?}"
    );
}

fn percentile(samples: &[Duration], percentile: usize) -> Duration {
    let index = (samples.len() * percentile).div_ceil(100).saturating_sub(1);
    samples[index]
}
