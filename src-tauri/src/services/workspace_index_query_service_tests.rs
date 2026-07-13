use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceIndexedSymbol, WorkspaceScanSummary, WorkspaceSnapshot, WorkspaceTextSearchOptions,
    WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_facade_service::{
    query_facade_file_symbols_with_readiness, query_facade_search_everywhere_with_readiness,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_query_service::{
    query_workspace_candidates, query_workspace_quick_open, search_workspace_text,
    WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn snapshot(root_path: &str, truncated: bool) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        root_name: "ArkDemo".to_string(),
        root_path: root_path.to_string(),
        files: vec![format!("{root_path}/entry/src/main/ets/pages/Index.ets")],
        scan_summary: WorkspaceScanSummary {
            scanned_files: 1,
            skipped_entries: 0,
            truncated,
            exclude_rules: Vec::new(),
        },
    }
}

#[test]
fn query_service_preserves_partial_freshness_for_quick_open() {
    let root = unique_temp_dir("workspace-query-facade-partial");
    fs::create_dir_all(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages"),
    )
    .unwrap();
    fs::write(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages")
            .join("Index.ets"),
        "",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&snapshot(&root_path, true))
        .unwrap();

    let matches = query_workspace_quick_open(&runtime, &root_path, "index", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "partial");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_service_preserves_stale_freshness_from_restored_index() {
    let root = unique_temp_dir("workspace-query-facade-stale");
    fs::create_dir_all(
        root.join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_path = format!("{root_path}/entry/src/main/ets/pages/Stale.ets");
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.replace('/', "\\")),
            file_paths: vec![indexed_path],
            symbols: Vec::new(),
            indexed_at: Some(1),
            partial_reason: None,
        },
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let matches = query_workspace_quick_open(&runtime, &root_path, "stale", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "stale");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_service_preserves_stale_freshness_for_symbol_scopes() {
    let root = unique_temp_dir("workspace-query-facade-stale-symbol");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_path = format!("{root_path}/entry/src/StaleLogin.ets");
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.replace('/', "\\")),
            file_paths: vec![indexed_path.clone()],
            symbols: vec![WorkspaceIndexedSymbol {
                source: "class".to_string(),
                kind: "class".to_string(),
                name: "StaleLoginController".to_string(),
                path: indexed_path,
                line: 1,
                column: 7,
                container: None,
                signature: None,
                visibility: None,
            }],
            indexed_at: Some(1),
            partial_reason: None,
        },
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let matches = query_workspace_candidates(
        &runtime,
        &root_path,
        "stale",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "stale");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_search_envelope_reports_ready_readiness() {
    let root = unique_temp_dir("workspace-query-envelope-ready");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Ready.ets"), "class ReadyController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "ready",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(
        envelope.readiness.requested_generation,
        envelope.readiness.served_generation.unwrap()
    );
    assert!(!envelope.readiness.retryable);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_search_envelope_reports_stale_readiness() {
    let root = unique_temp_dir("workspace-query-envelope-stale");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_path = format!("{root_path}/entry/src/Stale.ets");
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.replace('/', "\\")),
            file_paths: vec![indexed_path.clone()],
            symbols: vec![WorkspaceIndexedSymbol {
                source: "class".to_string(),
                kind: "class".to_string(),
                name: "StaleController".to_string(),
                path: indexed_path,
                line: 1,
                column: 7,
                container: None,
                signature: None,
                visibility: None,
            }],
            indexed_at: Some(9),
            partial_reason: None,
        },
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let envelope = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "stale",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Stale
    );
    assert_eq!(envelope.readiness.requested_generation, 10);
    assert_eq!(envelope.readiness.served_generation, Some(9));
    assert!(envelope.readiness.retryable);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn facade_file_symbols_envelope_reports_partial_readiness() {
    let root = unique_temp_dir("workspace-query-envelope-file-symbols");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let file_path = source_dir.join("Partial.ets");
    fs::write(
        &file_path,
        "class PartialController {\n  partialAction() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.clone(),
            files: vec![file_path.to_string_lossy().to_string()],
            scan_summary: WorkspaceScanSummary {
                scanned_files: 20_000,
                skipped_entries: 2,
                truncated: true,
                exclude_rules: Vec::new(),
            },
        })
        .unwrap();

    let envelope = query_facade_file_symbols_with_readiness(
        &runtime,
        &root_path,
        &file_path.to_string_lossy(),
        "",
        8,
    )
    .unwrap();

    assert_eq!(
        envelope
            .items
            .iter()
            .map(|candidate| candidate.title.as_str())
            .collect::<Vec<_>>(),
        vec!["PartialController", "partialAction"]
    );
    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Partial
    );
    assert!(envelope.readiness.retryable);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_service_preserves_partial_freshness_for_symbol_scopes() {
    let root = unique_temp_dir("workspace-query-facade-partial-symbol");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Partial.ets"), "class PartialLogin {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime
        .index_workspace_snapshot(&WorkspaceSnapshot {
            root_name: "ArkDemo".to_string(),
            root_path: root_path.clone(),
            files: vec![source_dir.join("Partial.ets").to_string_lossy().to_string()],
            scan_summary: WorkspaceScanSummary {
                scanned_files: 20_000,
                skipped_entries: 3,
                truncated: true,
                exclude_rules: Vec::new(),
            },
        })
        .unwrap();

    let matches = query_workspace_candidates(
        &runtime,
        &root_path,
        "partial",
        WorkspaceIndexQueryScope::Classes,
        8,
    )
    .unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].freshness, "partial");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_service_routes_plain_text_to_index_and_regex_to_file_search() {
    let root = unique_temp_dir("workspace-query-facade-text");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"QueryFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let plain =
        search_workspace_text(&runtime, plain_request(&root_path, "queryfacadetarget")).unwrap();
    let regex =
        search_workspace_text(&runtime, plain_request(&root_path, "/Text\\(\".+\"\\)/")).unwrap();

    assert_eq!(plain.matches.len(), 1);
    assert_eq!(regex.matches.len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_service_routes_whole_word_text_search_to_index() {
    let root = unique_temp_dir("query-service-whole-word-text-index");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let source_path = root.join("entry").join("src").join("Index.ets");
    fs::write(&source_path, "indexBuilder()\nstruct Index {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::remove_file(&source_path).unwrap();
    let mut request = plain_request(&root_path, "index");
    request.options.whole_word = true;

    let result = search_workspace_text(&runtime, request).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].preview, "struct Index {}");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn all_scope_excludes_full_text_candidates() {
    let root = unique_temp_dir("workspace-query-all-no-text");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        "struct Index {\n  build() { Text(\"QueryFacadeTarget\") }\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let all = query_workspace_candidates(
        &runtime,
        &root_path,
        "queryfacadetarget",
        WorkspaceIndexQueryScope::All,
        8,
    )
    .unwrap();
    let text = query_workspace_candidates(
        &runtime,
        &root_path,
        "queryfacadetarget",
        WorkspaceIndexQueryScope::Text,
        8,
    )
    .unwrap();

    assert!(all.iter().all(|candidate| candidate.source != "text"));
    assert_eq!(text.len(), 1);
    assert_eq!(text[0].source, "text");

    fs::remove_dir_all(root).unwrap();
}

fn plain_request(root_path: &str, query: &str) -> WorkspaceTextSearchRequest {
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
        context_lines: 0,
    }
}
