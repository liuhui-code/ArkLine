use std::fs;

use rusqlite::Connection;

use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_facade_search_service::query_facade_text_search;
use crate::services::workspace_index_facade_service::WorkspaceIndexFacadeItem;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn partial_text_search_falls_back_only_to_unready_content_files_after_an_index_miss() {
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
