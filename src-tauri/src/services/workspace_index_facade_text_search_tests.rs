use std::fs;

use rusqlite::Connection;

use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_discovery_service::WorkspaceDiscoveredFile;
use crate::services::workspace_discovery_store_service::{
    replace_discovered_file_chunk, update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_facade_search_service::query_facade_text_search;
use crate::services::workspace_index_facade_service::{
    query_facade_text_search_result, query_workspace_index_facade, WorkspaceIndexFacadeItem,
    WorkspaceIndexFacadeRequest,
};
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn facade_routes_text_search_scope_queries() {
    let root = create_empty_workspace("facade-text-search");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"QueryFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "queryfacadetarget".to_string(),
            scope: WorkspaceIndexQueryScope::Text,
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_explain_contains(&envelope.explain, "query:searchEverywhere");
    assert_explain_contains(
        &envelope.explain,
        "used:FileIndex,WorkspaceIndex,SDKIndex,TextIndex",
    );
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.source == "text"
                && candidate.title.contains("QueryFacadeTarget")
                && candidate.line == Some(2)
    )));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_global_text_search_result_and_preserves_regex_fallback() {
    let root = create_empty_workspace("facade-global-text-search");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"GlobalFacadeTarget\") }\n}\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("Noise.ets"),
        "struct Noise {\n  build() { Button(\"Other\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let plain = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "globalfacadetarget".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();
    let regex = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "/Text\\(\".+\"\\)/".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();

    assert_eq!(plain.matches.len(), 1);
    assert_eq!(regex.matches.len(), 1);
    assert_eq!(regex.prefilter_skipped_files, 1);
    assert!(plain.matches[0].summary.contains("GlobalFacadeTarget"));
    let events = load_recent_index_events(&root_path, 8).unwrap();
    assert!(events.iter().any(|event| {
        event.scope == "query"
            && event.kind == "textSearch"
            && event.phase == "hit"
            && event.payload_json.contains("query:textSearch")
            && event.payload_json.contains("prefilterSkippedFiles:1")
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_whole_word_text_search_through_index() {
    let root = create_empty_workspace("facade-whole-word-text-search");
    let source_dir = create_workspace_source_dir(&root);
    let source_path = source_dir.join("Index.ets");
    fs::write(&source_path, "indexBuilder()\nstruct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::remove_file(&source_path).unwrap();

    let result = query_facade_text_search_result(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "index".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: true,
            },
            limit: 4,
            context_lines: 0,
        },
    )
    .unwrap();
    let envelope = query_facade_text_search(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "index".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: true,
            },
            limit: 4,
            context_lines: 0,
        },
    )
    .unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "struct Index {}");
    assert_eq!(envelope.confidence.as_deref(), Some("indexed"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_routes_text_search_requests_with_readiness_and_explain() {
    let root = create_empty_workspace("facade-text-search-request");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "Text(\"FacadeRequestTarget\")\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::TextSearch {
            request: WorkspaceTextSearchRequest {
                root_path: root_path.clone(),
                query: "facaderequesttarget".to_string(),
                generation: None,
                cursor: None,
                options: WorkspaceTextSearchOptions {
                    case_sensitive: false,
                    whole_word: false,
                },
                limit: 8,
                context_lines: 0,
            },
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_explain_contains(&envelope.explain, "query:textSearch");
    assert_explain_contains(&envelope.explain, "used:TextIndex");
    assert_explain_contains(&envelope.explain, "searchedFiles:1");
    assert_explain_contains(&envelope.explain, "prefilterSkippedFiles:0");
    assert_explain_contains(&envelope.explain, "limitReached:false");
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)] if result.matches[0].summary.contains("FacadeRequestTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_falls_back_when_text_index_layer_is_missing() {
    let root = create_empty_workspace("facade-text-search-partial-content");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Index.ets"),
        "Text(\"PartialLayerTarget\")\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    clear_content_index(&root);

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::TextSearch {
            request: WorkspaceTextSearchRequest {
                root_path: root_path.clone(),
                query: "partiallayertarget".to_string(),
                generation: None,
                cursor: None,
                options: WorkspaceTextSearchOptions {
                    case_sensitive: false,
                    whole_word: false,
                },
                limit: 8,
                context_lines: 0,
            },
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert_explain_contains(&envelope.explain, "skipped:TextIndex:missing");
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)] if result.matches[0].summary.contains("PartialLayerTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_uses_partial_content_index_without_scanning_the_workspace() {
    let root = create_empty_workspace("facade-text-search-partial-usable");
    let source_dir = create_workspace_source_dir(&root);
    let indexed = source_dir.join("Indexed.ets");
    let deferred = source_dir.join("Deferred.ets");
    fs::write(&indexed, "Text(\"PartialIndexedTarget\")\n").unwrap();
    fs::write(&deferred, "Text(\"DeferredNoise\")\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    remove_content_rows(&root, &deferred.to_string_lossy());
    fs::remove_file(&indexed).unwrap();

    let envelope = query_facade_text_search(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "partialindexedtarget".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert_eq!(envelope.confidence.as_deref(), Some("indexedPartial"));
    assert!(envelope
        .explain
        .iter()
        .any(|line| line.starts_with("used:TextIndex:partial:")));
    assert!(!envelope.explain.iter().any(|line| line.contains("missing")));
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)]
            if result.matches[0].summary.contains("PartialIndexedTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_fallback_uses_ready_discovery_when_runtime_paths_are_empty() {
    let root = create_empty_workspace("facade-text-search-discovery-fallback");
    let source = create_workspace_source_dir(&root).join("Discovered.ets");
    fs::write(&source, "Text(\"PersistedDiscoveryTarget\")\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let source_path = source.to_string_lossy().to_string();
    replace_discovered_file_chunk(
        &root_path,
        1,
        &[WorkspaceDiscoveredFile {
            path: source_path,
            size_bytes: fs::metadata(&source).unwrap().len(),
            modified_ms: None,
        }],
    )
    .unwrap();
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "ready".to_string(),
        discovered_count: 1,
        excluded_count: 0,
        cursor: None,
        error: None,
    })
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let envelope = query_facade_text_search(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "persisteddiscoverytarget".to_string(),
            generation: None,
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 8,
            context_lines: 0,
        },
    )
    .unwrap();

    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)]
            if result.searched_files == 1
                && result.matches[0].summary.contains("PersistedDiscoveryTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn search_everywhere_text_scope_falls_back_when_text_index_layer_is_missing() {
    let root = create_empty_workspace("facade-search-text-partial-content");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("Search.ets"),
        "Text(\"EverywherePartialTarget\")\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    clear_content_index(&root);

    let envelope = query_workspace_index_facade(
        &runtime,
        WorkspaceIndexFacadeRequest::SearchEverywhere {
            root_path: root_path.clone(),
            query: "everywherepartialtarget".to_string(),
            scope: WorkspaceIndexQueryScope::Text,
            limit: 8,
        },
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert_explain_contains(&envelope.explain, "skipped:TextIndex:missing");
    assert!(envelope.items.iter().any(|item| matches!(
        item,
        WorkspaceIndexFacadeItem::Search(candidate)
            if candidate.source == "text" && candidate.title.contains("EverywherePartialTarget")
    )));
    fs::remove_dir_all(root).unwrap();
}

fn clear_content_index(root: &std::path::Path) {
    let sqlite_path = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(sqlite_path).unwrap();
    connection
        .execute("delete from workspace_content_lines", [])
        .unwrap();
    connection
        .execute("delete from workspace_content_fts", [])
        .unwrap();
    connection
        .execute("delete from workspace_content_trigram_fts", [])
        .unwrap();
    connection
        .execute("delete from workspace_content_files", [])
        .unwrap();
}

fn remove_content_rows(root: &std::path::Path, path: &str) {
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let path = path.replace('/', "\\");
    for table in [
        "workspace_content_lines",
        "workspace_content_fts",
        "workspace_content_trigram_fts",
        "workspace_content_files",
    ] {
        connection
            .execute(&format!("delete from {table} where path = ?1"), [&path])
            .unwrap();
    }
}

fn assert_explain_contains(explain: &[String], expected: &str) {
    assert!(
        explain.iter().any(|line| line == expected),
        "expected explain to contain {expected:?}, got {explain:?}"
    );
}
