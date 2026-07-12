use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_search_ranking_service::{
    build_file_candidates, sort_search_everywhere_candidates_with_context,
    sort_text_candidates_by_lexical_match, WorkspaceSearchRankingContext,
};

#[test]
fn file_ranking_prefers_exact_then_prefix_then_contains_matches() {
    let paths = vec![
        "/workspace/src/MyLogin.ets".to_string(),
        "/workspace/src/LoginPage.ets".to_string(),
        "/workspace/src/Login.ets".to_string(),
    ];

    let ranked = build_file_candidates(&paths, "login", 8, "ready");
    let titles = ranked
        .iter()
        .map(|candidate| candidate.title.as_str())
        .collect::<Vec<_>>();

    assert_eq!(titles, vec!["Login.ets", "LoginPage.ets", "MyLogin.ets"]);
}

#[test]
fn file_ranking_prefers_camel_case_acronym_over_loose_fuzzy_match() {
    let paths = vec![
        "/workspace/src/LandingPage.ets".to_string(),
        "/workspace/src/LongParserAdapter.ets".to_string(),
        "/workspace/src/LocalProfile.ets".to_string(),
    ];

    let ranked = build_file_candidates(&paths, "lpa", 8, "ready");

    assert_eq!(ranked[0].title, "LongParserAdapter.ets");
}

#[test]
fn text_ranking_prefers_summary_matches_over_path_only_matches() {
    let mut candidates = vec![
        text_candidate(
            "C:/workspace/src/query/Unrelated.ets",
            "render",
            "src/query/Unrelated.ets:4",
        ),
        text_candidate(
            "C:/workspace/src/pages/Home.ets",
            "queryProfile()",
            "src/pages/Home.ets:8",
        ),
    ];

    sort_text_candidates_by_lexical_match(&mut candidates, "query");

    assert_eq!(candidates[0].title, "queryProfile()");
    assert!(candidates[0].score > candidates[1].score);
}

#[test]
fn search_ranking_context_prefers_active_and_recent_paths_within_source_group() {
    let mut candidates = vec![
        candidate("symbol", "Other symbol", "/workspace/src/Other.ets", 120.0),
        candidate("symbol", "Active symbol", "/workspace/src/Active.ets", 90.0),
        candidate("symbol", "Recent symbol", "C:\\workspace\\src\\Recent.ets", 110.0),
    ];

    sort_search_everywhere_candidates_with_context(
        &mut candidates,
        8,
        &WorkspaceSearchRankingContext {
            active_path: Some("/workspace/src/Active.ets".to_string()),
            recent_paths: vec!["c:/workspace/src/Recent.ets".to_string()],
        },
    );

    assert_eq!(
        titles(&candidates),
        vec!["Active symbol", "Recent symbol", "Other symbol"]
    );
}

#[test]
fn search_ranking_context_uses_project_proximity_when_scores_tie() {
    let mut candidates = vec![
        candidate(
            "file",
            "Remote Settings",
            "/workspace/features/settings/Settings.ets",
            90.0,
        ),
        candidate(
            "file",
            "Local Settings",
            "/workspace/src/pages/settings/Settings.ets",
            90.0,
        ),
    ];

    sort_search_everywhere_candidates_with_context(
        &mut candidates,
        8,
        &WorkspaceSearchRankingContext {
            active_path: Some("/workspace/src/pages/Home.ets".to_string()),
            recent_paths: Vec::new(),
        },
    );

    assert_eq!(titles(&candidates), vec!["Local Settings", "Remote Settings"]);
}

fn text_candidate(path: &str, title: &str, subtitle: &str) -> WorkspaceSearchCandidate {
    candidate("text", title, path, 20.0).with_subtitle(subtitle)
}

fn candidate(source: &str, title: &str, path: &str, score: f64) -> WorkspaceSearchCandidate {
    WorkspaceSearchCandidate {
        id: format!("{source}:{path}:{title}"),
        source: source.to_string(),
        kind: source.to_string(),
        title: title.to_string(),
        subtitle: path.to_string(),
        path: Some(path.to_string()),
        line: Some(1),
        column: Some(1),
        score,
        freshness: "ready".to_string(),
        container: None,
        signature: None,
        visibility: None,
    }
}

trait CandidateTestExt {
    fn with_subtitle(self, subtitle: &str) -> Self;
}

impl CandidateTestExt for WorkspaceSearchCandidate {
    fn with_subtitle(mut self, subtitle: &str) -> Self {
        self.subtitle = subtitle.to_string();
        self
    }
}

fn titles(candidates: &[WorkspaceSearchCandidate]) -> Vec<&str> {
    candidates
        .iter()
        .map(|candidate| candidate.title.as_str())
        .collect()
}
