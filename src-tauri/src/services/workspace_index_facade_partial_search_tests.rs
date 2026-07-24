use std::fs;

use rusqlite::Connection;

use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_discovery_service::WorkspaceDiscoveredFile;
use crate::services::workspace_discovery_store_service::{
    replace_discovered_file_chunk, update_discovery_state, WorkspaceDiscoveryState,
};
use crate::services::workspace_index_facade_search_service::query_facade_text_search;
use crate::services::workspace_index_facade_service::WorkspaceIndexFacadeItem;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn partial_text_search_uses_stable_discovery_fallback_after_an_index_miss() {
    let root = create_empty_workspace("facade-text-search-partial-hybrid");
    let source_dir = create_workspace_source_dir(&root);
    let indexed = source_dir.join("Indexed.ets");
    let deferred = source_dir.join("Deferred.ets");
    fs::write(&indexed, "Text(\"IndexedNoise\")\n").unwrap();
    fs::write(&deferred, "Text(\"DeferredHybridTarget\")\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    remove_content_rows(&root, &deferred.to_string_lossy());
    fs::remove_file(&indexed).unwrap();

    let envelope = query_facade_text_search(
        &runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.clone(),
            query: "deferredhybridtarget".to_string(),
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
    assert!(matches!(
        envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)]
            if result.matches.len() == 1
                && result.matches[0].summary.contains("DeferredHybridTarget")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn large_missing_text_index_returns_one_result_with_a_filesystem_cursor() {
    let root = create_empty_workspace("facade-text-search-large-first-result");
    let source_dir = create_workspace_source_dir(&root);
    let root_path = root.to_string_lossy().to_string();
    let mut discovered = Vec::new();
    for index in 0..1_000 {
        let path = source_dir.join(format!("Page{index:04}.ets"));
        let content = if matches!(index, 0 | 500 | 999) {
            format!("const fastFallbackTarget{index} = true;\n")
        } else {
            format!("const unrelatedValue{index} = true;\n")
        };
        fs::write(&path, content).unwrap();
        discovered.push(WorkspaceDiscoveredFile {
            path: path.to_string_lossy().to_string(),
            size_bytes: fs::metadata(&path).unwrap().len(),
            modified_ms: None,
        });
    }
    replace_discovered_file_chunk(&root_path, 1, &discovered).unwrap();
    update_discovery_state(&WorkspaceDiscoveryState {
        root_path: root_path.clone(),
        generation: 1,
        status: "ready".to_string(),
        discovered_count: discovered.len(),
        excluded_count: 0,
        cursor: None,
        error: None,
    })
    .unwrap();

    let runtime = WorkspaceIndexRuntime::default();
    let request = WorkspaceTextSearchRequest {
        root_path: root_path.clone(),
        query: "fastfallbacktarget".to_string(),
        generation: None,
        cursor: None,
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 50,
        context_lines: 0,
    };
    let envelope = query_facade_text_search(&runtime, request.clone()).unwrap();

    let WorkspaceIndexFacadeItem::TextSearch(first_page) = &envelope.items[0] else {
        panic!("expected text search result");
    };
    assert_eq!(first_page.matches.len(), 1);
    assert!(first_page.partial);
    assert_eq!(
        first_page
            .next_cursor
            .as_ref()
            .and_then(|cursor| cursor.source.as_deref()),
        Some("filesystem")
    );

    let second_envelope = query_facade_text_search(
        &runtime,
        WorkspaceTextSearchRequest {
            cursor: first_page.next_cursor.clone(),
            limit: 2,
            ..request
        },
    )
    .unwrap();
    assert!(matches!(
        second_envelope.items.as_slice(),
        [WorkspaceIndexFacadeItem::TextSearch(result)] if result.matches.len() == 2
    ));
    fs::remove_dir_all(root).unwrap();
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
