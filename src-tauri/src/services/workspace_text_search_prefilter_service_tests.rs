use crate::services::workspace_text_search_prefilter_service::{
    content_matches_prefilter, plan_regex_prefilter,
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
