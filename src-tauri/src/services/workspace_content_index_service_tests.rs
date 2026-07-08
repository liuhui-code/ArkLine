use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::{
    index_workspace_content, search_indexed_workspace_content, update_workspace_content,
};

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
fn searches_persisted_line_content_after_source_file_is_unavailable() {
    let root = unique_temp_dir("workspace-content-index");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(
        &file_path,
        ["@Entry", "struct Index {", "  Text(\"Welcome\")", "}"].join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_paths = vec![file_path.to_string_lossy().to_string()];
    index_workspace_content(&root_path, &indexed_paths).unwrap();
    fs::remove_file(&file_path).unwrap();

    let result = search_indexed_workspace_content(&request(&root_path, "welcome")).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].relative_path, "entry/src/Index.ets");
    assert_eq!(result.matches[0].path, file_path.to_string_lossy());
    assert!(fs::read_to_string(&result.matches[0].path).is_err());
    assert_eq!(result.matches[0].line, 3);
    assert_eq!(result.matches[0].preview, "  Text(\"Welcome\")");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn indexed_text_search_returns_filesystem_paths_that_can_be_opened() {
    let root = unique_temp_dir("workspace-content-openable-paths");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, "struct Index {\n  Text(\"Welcome\")\n}").unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();

    let result = search_indexed_workspace_content(&request(&root_path, "welcome")).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].path, file_path.to_string_lossy());
    assert!(fs::read_to_string(&result.matches[0].path)
        .unwrap()
        .contains("Welcome"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_fts_table_for_indexed_content_queries() {
    let root = unique_temp_dir("workspace-content-fts");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, "struct Index {}").unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();

    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_master where name = 'workspace_content_fts'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(table_count, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supports_fts_prefix_queries_for_content_search() {
    let root = unique_temp_dir("workspace-content-fts-prefix");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, "Text(\"Welcome\")").unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();

    let result = search_indexed_workspace_content(&request(&root_path, "welc")).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "Text(\"Welcome\")");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn escapes_like_wildcards_when_fts_falls_back_to_line_search() {
    let root = unique_temp_dir("workspace-content-like-wildcards");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(
        &file_path,
        ["Text(\"plain\")", "Text(\"100% ready\")"].join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();

    let mut search_request = request(&root_path, "%");
    search_request.limit = 1;
    let result = search_indexed_workspace_content(&search_request).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "Text(\"100% ready\")");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn escapes_like_single_character_wildcards() {
    let root = unique_temp_dir("workspace-content-like-underscore");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&file_path, ["Text(\"abc\")", "Text(\"a_c\")"].join("\n")).unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();

    let mut search_request = request(&root_path, "_");
    search_request.limit = 1;
    let result = search_indexed_workspace_content(&search_request).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "Text(\"a_c\")");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn case_sensitive_index_search_does_not_let_lowercase_candidates_take_the_limit() {
    let root = unique_temp_dir("workspace-content-case-sensitive-limit");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(
        &file_path,
        ["Text(\"token\")", "Text(\"Token\")"].join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();
    let mut search_request = request(&root_path, "Token");
    search_request.options.case_sensitive = true;
    search_request.limit = 1;

    let result = search_indexed_workspace_content(&search_request).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "Text(\"Token\")");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn indexed_content_search_returns_cursor_for_next_page() {
    let root = unique_temp_dir("workspace-content-cursor");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let file_path = root.join("entry").join("src").join("Index.ets");
    fs::write(
        &file_path,
        ["Text(\"CursorOne\")", "Text(\"CursorTwo\")", "Text(\"CursorThree\")"].join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(&root_path, &[file_path.to_string_lossy().to_string()]).unwrap();
    let mut first_request = request(&root_path, "Cursor");
    first_request.limit = 2;
    let first = search_indexed_workspace_content(&first_request).unwrap();
    let mut second_request = request(&root_path, "Cursor");
    second_request.limit = 2;
    second_request.cursor = first.next_cursor.clone();
    let second = search_indexed_workspace_content(&second_request).unwrap();

    assert_eq!(first.matches.len(), 2);
    assert!(first.next_cursor.is_some());
    assert_eq!(second.matches.len(), 1);
    assert_eq!(second.matches[0].preview, "Text(\"CursorThree\")");
    assert_eq!(second.next_cursor, None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn updates_only_changed_paths_in_content_index() {
    let root = unique_temp_dir("workspace-content-incremental");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let kept_path = root.join("entry").join("src").join("Kept.ets");
    let removed_path = root.join("entry").join("src").join("Removed.ets");
    let added_path = root.join("entry").join("src").join("Added.ets");
    fs::write(&kept_path, "Text(\"AlphaPersisted\")").unwrap();
    fs::write(&removed_path, "Text(\"BetaRemoved\")").unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_content(
        &root_path,
        &[
            kept_path.to_string_lossy().to_string(),
            removed_path.to_string_lossy().to_string(),
        ],
    )
    .unwrap();
    fs::remove_file(&kept_path).unwrap();
    fs::write(&added_path, "Text(\"GammaAdded\")").unwrap();

    update_workspace_content(
        &root_path,
        &[added_path.to_string_lossy().to_string()],
        &[removed_path.to_string_lossy().to_string()],
    )
    .unwrap();

    assert_eq!(
        search_indexed_workspace_content(&request(&root_path, "alphapersisted"))
            .unwrap()
            .matches
            .len(),
        1
    );
    assert_eq!(
        search_indexed_workspace_content(&request(&root_path, "betaremoved"))
            .unwrap()
            .matches
            .len(),
        0
    );
    assert_eq!(
        search_indexed_workspace_content(&request(&root_path, "gammaadded"))
            .unwrap()
            .matches
            .len(),
        1
    );

    fs::remove_dir_all(root).unwrap();
}
