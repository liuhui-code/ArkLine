use crate::services::workspace_search_ranking_service::build_file_candidates;

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
