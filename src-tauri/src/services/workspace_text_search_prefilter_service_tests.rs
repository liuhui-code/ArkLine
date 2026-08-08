use crate::services::workspace_text_search_prefilter_service::{
    content_matches_prefilter, plan_query_regex_prefilter, plan_regex_prefilter,
};

#[test]
fn regex_prefilter_uses_longest_literal_segment() {
    let plan = plan_regex_prefilter("Text\\(\"ArkLine\"\\)\\.width", "");

    assert_eq!(
        plan.literal_hint.as_deref(),
        Some("Text(\"ArkLine\").width")
    );
    assert!(content_matches_prefilter(
        "Text(\"ArkLine\").width(12)",
        &plan
    ));
    assert!(!content_matches_prefilter("Button(\"Other\")", &plan));
}

#[test]
fn regex_prefilter_respects_case_insensitive_flag() {
    let plan = plan_regex_prefilter("ArkLine", "i");

    assert_eq!(plan.literal_hint.as_deref(), Some("ArkLine"));
    assert!(content_matches_prefilter("arkline", &plan));
}

#[test]
fn regex_prefilter_allows_scan_when_no_stable_literal_exists() {
    let plan = plan_regex_prefilter("\\w+\\s+\\d+", "");

    assert_eq!(plan.literal_hint, None);
    assert!(content_matches_prefilter("anything", &plan));
}

#[test]
fn query_prefilter_extracts_literal_and_flags_from_regex_syntax() {
    let plan = plan_query_regex_prefilter("/Text\\(\"ArkLine\"\\)\\.width/i")
        .expect("valid regex query should produce a plan");

    assert_eq!(
        plan.literal_hint.as_deref(),
        Some("Text(\"ArkLine\").width")
    );
    assert!(plan.case_insensitive);
    assert!(plan_query_regex_prefilter("plain text").is_none());
}

#[test]
fn regex_prefilter_rejects_literals_that_are_not_required() {
    assert_eq!(plan_regex_prefilter("foo|barbaz", "").literal_hint, None);
    assert_eq!(
        plan_regex_prefilter("optional?target", "").literal_hint,
        None
    );
    assert_eq!(
        plan_regex_prefilter("prefix.*suffix", "").literal_hint,
        None
    );
}
