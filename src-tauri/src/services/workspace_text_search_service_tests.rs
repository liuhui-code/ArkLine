use crate::models::workspace::{
    WorkspaceTextSearchCursor, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_text_search_service::{
    search_workspace_text, search_workspace_text_with_cancellation,
};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn request(root_path: &str, query: &str) -> WorkspaceTextSearchRequest {
    WorkspaceTextSearchRequest {
        root_path: root_path.to_string(),
        query: query.to_string(),
        generation: None,
        cursor: None,
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 1,
    }
}

#[test]
fn finds_text_matches_with_context_from_indexed_paths() {
    let root = unique_temp_dir("workspace-text-search");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Index.ets"),
        [
            "@Entry",
            "@Component",
            "struct Index {",
            "  build() {}",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![format!("{root_path}\\entry\\src\\Index.ets")];

    let result = search_workspace_text(&request(&root_path, "component"), &indexed_paths);

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].relative_path, "entry/src/Index.ets");
    assert_eq!(result.matches[0].file_name, "Index.ets");
    assert_eq!(result.matches[0].line, 2);
    assert_eq!(result.matches[0].column, 2);
    assert_eq!(result.matches[0].context_before[0].text, "@Entry");
    assert!(!result.partial);
    assert_eq!(result.prefilter_skipped_files, 0);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supports_regex_case_sensitive_and_whole_word_matching() {
    let root = unique_temp_dir("workspace-text-search-options");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Index.ets"),
        [
            "struct Index {",
            "  indexBuilder() {}",
            "  Text(\"ArkLine\")",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![root
        .join("entry")
        .join("src")
        .join("Index.ets")
        .to_string_lossy()
        .to_string()];

    let regex_result =
        search_workspace_text(&request(&root_path, "/Text\\(\".+\"\\)/"), &indexed_paths);
    assert_eq!(regex_result.matches[0].line, 3);

    let mut case_request = request(&root_path, "index");
    case_request.options.case_sensitive = true;
    let case_result = search_workspace_text(&case_request, &indexed_paths);
    assert_eq!(case_result.matches.len(), 1);
    assert_eq!(case_result.matches[0].line, 2);

    let mut whole_word_request = request(&root_path, "index");
    whole_word_request.options.whole_word = true;
    let whole_word_result = search_workspace_text(&whole_word_request, &indexed_paths);
    assert_eq!(whole_word_result.matches.len(), 1);
    assert_eq!(whole_word_result.matches[0].line, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn regex_search_prefilters_files_with_literal_hint() {
    let root = unique_temp_dir("workspace-text-search-regex-prefilter");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Noise.ets"),
        "alpha beta gamma",
    )
    .unwrap();
    fs::write(
        root.join("entry").join("src").join("Match.ets"),
        "target    42",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![
        root.join("entry")
            .join("src")
            .join("Noise.ets")
            .to_string_lossy()
            .to_string(),
        root.join("entry")
            .join("src")
            .join("Match.ets")
            .to_string_lossy()
            .to_string(),
    ];

    let result = search_workspace_text(&request(&root_path, "/target\\s+\\d+/"), &indexed_paths);

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].file_name, "Match.ets");
    assert_eq!(result.searched_files, 1);
    assert_eq!(result.prefilter_skipped_files, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_invalid_regex_without_matches() {
    let root = unique_temp_dir("workspace-text-search-invalid-regex");
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let result = search_workspace_text(&request(&root_path, "/(/"), &[]);

    assert!(matches!(
        result.query,
        crate::models::workspace::WorkspaceTextSearchQuery::Invalid { .. }
    ));
    assert!(result.matches.is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn builds_summaries_without_slicing_inside_utf8_characters() {
    let root = unique_temp_dir("workspace-text-search-unicode-summary");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Index.ets"),
        format!("{}a target width", "汉".repeat(20)),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![root
        .join("entry")
        .join("src")
        .join("Index.ets")
        .to_string_lossy()
        .to_string()];

    let result = search_workspace_text(&request(&root_path, "target"), &indexed_paths);

    assert_eq!(result.matches.len(), 1);
    assert!(result.matches[0].summary.contains("target"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stops_between_files_when_cancelled() {
    let root = unique_temp_dir("workspace-text-search-cancelled");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("First.ets"),
        "target one",
    )
    .unwrap();
    fs::write(
        root.join("entry").join("src").join("Second.ets"),
        "target two",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![
        root.join("entry")
            .join("src")
            .join("First.ets")
            .to_string_lossy()
            .to_string(),
        root.join("entry")
            .join("src")
            .join("Second.ets")
            .to_string_lossy()
            .to_string(),
    ];
    let mut checks = 0;

    let result = search_workspace_text_with_cancellation(
        &request(&root_path, "target"),
        &indexed_paths,
        || {
            checks += 1;
            checks > 1
        },
    );

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].file_name, "First.ets");
    assert!(result.partial);
    assert_eq!(result.searched_files, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn returns_cursor_for_next_page_without_repeating_matches() {
    let root = unique_temp_dir("workspace-text-search-cursor");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("First.ets"),
        ["target one", "target two", "target three"].join("\n"),
    )
    .unwrap();
    fs::write(
        root.join("entry").join("src").join("Second.ets"),
        "target four",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![
        root.join("entry")
            .join("src")
            .join("First.ets")
            .to_string_lossy()
            .to_string(),
        root.join("entry")
            .join("src")
            .join("Second.ets")
            .to_string_lossy()
            .to_string(),
    ];
    let mut first_request = request(&root_path, "target");
    first_request.limit = 2;
    let first = search_workspace_text(&first_request, &indexed_paths);
    let mut second_request = request(&root_path, "target");
    second_request.limit = 2;
    second_request.cursor = first.next_cursor.clone();
    let second = search_workspace_text(&second_request, &indexed_paths);

    assert_eq!(
        first
            .matches
            .iter()
            .map(|matched| matched.line)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(
        first.next_cursor,
        Some(WorkspaceTextSearchCursor {
            path_index: 0,
            line_index: 2,
            source: Some("filesystem".to_string()),
        })
    );
    assert_eq!(second.matches[0].line, 3);
    assert_eq!(second.matches[1].file_name, "Second.ets");
    assert_eq!(second.next_cursor, None);

    fs::remove_dir_all(root).unwrap();
}
