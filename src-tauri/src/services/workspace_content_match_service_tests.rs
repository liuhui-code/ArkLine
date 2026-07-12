use crate::services::workspace_content_match_service::{
    build_summary, find_line_match, slice_context,
};

#[test]
fn line_match_respects_case_sensitivity() {
    assert_eq!(
        find_line_match("Text(\"Token\")", "token", false, false),
        Some((6, 11))
    );
    assert_eq!(
        find_line_match("Text(\"Token\")", "token", true, false),
        None
    );
}

#[test]
fn whole_word_match_skips_embedded_identifier_text() {
    assert_eq!(
        find_line_match("indexBuilder(); struct Index {}", "index", false, true),
        Some((23, 28))
    );
}

#[test]
fn summary_keeps_utf8_boundaries() {
    let summary = build_summary("let message = \"你好 ArkLine Search\";", 15, 21);

    assert!(summary.contains("你好"));
    assert!(summary.contains("ArkLine"));
}

#[test]
fn slice_context_returns_one_based_line_numbers() {
    let context = slice_context(
        &["one".to_string(), "two".to_string(), "three".to_string()],
        1,
        3,
    );

    assert_eq!(context.len(), 2);
    assert_eq!(context[0].line, 2);
    assert_eq!(context[0].text, "two");
    assert_eq!(context[1].line, 3);
}
