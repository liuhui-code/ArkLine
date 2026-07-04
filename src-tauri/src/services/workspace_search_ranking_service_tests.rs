use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_search_ranking_service::{
    build_file_candidates, sort_text_candidates_by_lexical_match,
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

fn text_candidate(path: &str, title: &str, subtitle: &str) -> WorkspaceSearchCandidate {
    WorkspaceSearchCandidate {
        id: format!("text:{path}:1:1"),
        source: "text".to_string(),
        kind: "text".to_string(),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        path: Some(path.to_string()),
        line: Some(1),
        column: Some(1),
        score: 20.0,
        freshness: "ready".to_string(),
        container: None,
        signature: None,
        visibility: None,
    }
}
