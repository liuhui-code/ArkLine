use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceIndexState, WorkspaceIndexStatus,
    WorkspaceIndexedSymbol, WorkspaceScanSummary, WorkspaceSnapshot, WorkspaceTextSearchOptions,
    WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_query_service::{
    query_definition_candidates_with_readiness, query_workspace_candidates,
    query_workspace_candidates_with_readiness, query_workspace_file_symbols_with_readiness,
    query_workspace_quick_open, search_workspace_text, WorkspaceIndexQueryScope,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

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
fn query_facade_preserves_partial_freshness_for_quick_open() {
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
fn query_facade_preserves_stale_freshness_from_restored_index() {
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
fn query_facade_preserves_stale_freshness_for_symbol_scopes() {
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
fn query_facade_envelope_reports_ready_readiness() {
    let root = unique_temp_dir("workspace-query-envelope-ready");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Ready.ets"), "class ReadyController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_workspace_candidates_with_readiness(
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
fn query_facade_envelope_reports_stale_readiness() {
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

    let envelope = query_workspace_candidates_with_readiness(
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
fn file_symbols_envelope_reports_partial_readiness() {
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

    let envelope = query_workspace_file_symbols_with_readiness(
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
fn query_facade_preserves_partial_freshness_for_symbol_scopes() {
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
fn query_facade_routes_plain_text_to_index_and_regex_to_file_search() {
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
fn definition_facade_resolves_imported_class_through_stub_graph() {
    let root = unique_temp_dir("workspace-definition-import");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let user_path = source_dir.join("UserService.ets");
    let main_path = source_dir.join("Main.ets");
    fs::write(&user_path, "export class UserService {\n  load() {}\n}\n").unwrap();
    fs::write(
        &main_path,
        "import { UserService } from \"./UserService\"\nconst service = new UserService()\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: main_path.to_string_lossy().to_string(),
            line: 2,
            column: 22,
            content: Some(fs::read_to_string(&main_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert!(envelope.items.iter().any(|candidate| {
        candidate.path == user_path.to_string_lossy()
            && candidate.line == 1
            && candidate.preview.contains("UserService")
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn definition_facade_resolves_active_sdk_api_symbol() {
    let root = unique_temp_dir("workspace-definition-sdk");
    let workspace_dir = root.join("workspace");
    let sdk_dir = root.join("sdk");
    let source_dir = workspace_dir
        .join("entry")
        .join("src")
        .join("main")
        .join("ets");
    let api_dir = sdk_dir.join("ets").join("component");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&api_dir).unwrap();
    let page_path = source_dir.join("Index.ets");
    let api_path = api_dir.join("common.d.ts");
    fs::write(&page_path, "Text('hi').width(12)\n").unwrap();
    fs::write(
        &api_path,
        "declare class TextAttribute {\n  width(value: Length): TextAttribute\n}\n",
    )
    .unwrap();
    let root_path = workspace_dir.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_dir.to_string_lossy(), "12").unwrap();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: page_path.to_string_lossy().to_string(),
            line: 1,
            column: 12,
            content: Some(fs::read_to_string(&page_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert!(envelope.items.iter().any(|candidate| {
        candidate.path == api_path.to_string_lossy() && candidate.preview.contains("TextAttribute")
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn definition_facade_reports_stale_readiness_for_stale_index() {
    let root = unique_temp_dir("workspace-definition-stale");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let indexed_path = format!("{root_path}/entry/src/Stale.ets");
    persist_index_state(
        &root_path,
        &WorkspaceIndexState {
            status: WorkspaceIndexStatus::Stale,
            root_path: Some(root_path.replace('/', "\\")),
            file_paths: vec![indexed_path.clone()],
            symbols: Vec::new(),
            indexed_at: Some(7),
            partial_reason: None,
        },
    )
    .unwrap();
    let runtime = WorkspaceIndexRuntime::default();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: indexed_path,
            line: 1,
            column: 1,
            content: Some("class Stale {}\n".to_string()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Stale
    );
    assert!(envelope.readiness.retryable);

    fs::remove_dir_all(root).unwrap();
}

fn plain_request(root_path: &str, query: &str) -> WorkspaceTextSearchRequest {
    WorkspaceTextSearchRequest {
        root_path: root_path.to_string(),
        query: query.to_string(),
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 0,
    }
}
