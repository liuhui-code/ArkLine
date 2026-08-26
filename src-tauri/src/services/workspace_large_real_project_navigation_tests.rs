use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_facade_service::{
    query_facade_definition_candidates_with_readiness,
    query_facade_search_everywhere_with_readiness,
};
use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
use crate::services::workspace_index_query_service::WorkspaceIndexQueryScope;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

struct FixtureIndexCacheGuard(PathBuf);

impl Drop for FixtureIndexCacheGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should live below the repository root")
        .join("tests/fixtures/large-arkts/nim-uikit-harmony")
}

fn indexed_fixture() -> (PathBuf, WorkspaceIndexRuntime, Vec<String>) {
    let root = fixture_root();
    assert!(
        root.join("oh-package.json5").is_file(),
        "clone netease-kit/nim-uikit-harmony at commit 585feb45114a128a0d2a23947c83faf338e758f7 into {}",
        root.display()
    );
    let runtime = WorkspaceIndexRuntime::default();
    let state = runtime
        .refresh_workspace_index(&root.to_string_lossy())
        .expect("the real project should index");
    (root, runtime, state.file_paths)
}

pub(super) fn classes_are_searchable() {
    let _cache_guard = FixtureIndexCacheGuard(fixture_root().join(".arkline"));
    let (root, runtime, file_paths) = indexed_fixture();
    let root_path = root.to_string_lossy();
    let class_pattern = Regex::new(
        r"(?m)^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)",
    )
    .unwrap();
    let mut class_names = file_paths
        .iter()
        .filter(|path| path.ends_with(".ets") || path.ends_with(".ts"))
        .filter_map(|path| fs::read_to_string(path.replace('\\', "/")).ok())
        .flat_map(|content| {
            class_pattern
                .captures_iter(&content)
                .map(|capture| capture[1].to_string())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    class_names.sort();
    class_names.dedup();
    assert!(
        class_names.len() >= 200,
        "expected a large real-world class corpus, found {}",
        class_names.len()
    );

    let mut missing = Vec::new();
    for class_name in &class_names {
        let hits = query_facade_search_everywhere_with_readiness(
            &runtime,
            &root_path,
            class_name,
            WorkspaceIndexQueryScope::Classes,
            100,
        )
        .unwrap();
        if !hits.items.iter().any(|item| item.title == *class_name) {
            missing.push(class_name.clone());
        }
    }
    assert!(
        missing.is_empty(),
        "class search missed {} of {} declarations: {:?}",
        missing.len(),
        class_names.len(),
        missing
    );
}

#[cfg(unix)]
pub(super) fn class_search_is_retryable_during_catalog_only_stage() {
    let _cache_guard = FixtureIndexCacheGuard(fixture_root().join(".arkline"));
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let alias_parent = std::env::temp_dir().join(format!("arkline-netease-first-open-{suffix}"));
    let root = alias_parent.join("nim-uikit-harmony");
    fs::create_dir_all(&alias_parent).unwrap();
    std::os::unix::fs::symlink(fixture_root(), &root).unwrap();
    let root_path = root.to_string_lossy();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();

    manager.open_workspace_index(&root_path).unwrap();
    let results = manager
        .run_index_worker_once(&runtime, |_| {})
        .expect("the foreground open task should complete");
    assert!(results
        .iter()
        .any(|result| { result.kind == "open-workspace" && result.status == "ready" }));

    let hits = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "ChatP2PViewModel",
        WorkspaceIndexQueryScope::Classes,
        20,
    )
    .unwrap();
    let found = hits
        .items
        .iter()
        .any(|item| item.title == "ChatP2PViewModel");
    let task_states = results
        .iter()
        .map(|result| (result.kind.clone(), result.status.clone()))
        .collect::<Vec<_>>();
    let readiness = hits.readiness;
    fs::remove_dir_all(alias_parent).unwrap();
    assert!(
        !found,
        "symbol results must not be invented from the file catalog"
    );
    assert_eq!(readiness.state, WorkspaceIndexReadinessState::Partial);
    assert!(readiness.retryable);
    assert!(
        readiness.reason.as_deref().is_some_and(|reason| reason.contains("Symbol index layer")),
        "class search must explain the missing capability; readiness={readiness:?}; task_states={task_states:?}"
    );
}

#[cfg(unix)]
pub(super) fn packaged_index_pipeline_publishes_classes() {
    let _cache_guard = FixtureIndexCacheGuard(fixture_root().join(".arkline"));
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let alias_parent = std::env::temp_dir().join(format!("arkline-netease-sidecar-{suffix}"));
    let root = alias_parent.join("nim-uikit-harmony");
    fs::create_dir_all(&alias_parent).unwrap();
    std::os::unix::fs::symlink(fixture_root(), &root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let manager = WorkspaceIndexManagerRuntime::default();
    assert!(
        manager.indexer_snapshot().enabled,
        "run with ARKLINE_INDEXER_ENABLED=1"
    );
    manager.open_workspace_index(&root_path).unwrap();

    let started = Instant::now();
    let mut timeline = Vec::new();
    let mut found_at = None;
    for batch in 0..64 {
        let batch_started = Instant::now();
        let results = manager.run_index_worker_once(&runtime, |_| {}).unwrap();
        let class_found = query_facade_search_everywhere_with_readiness(
            &runtime,
            &root_path,
            "ChatP2PViewModel",
            WorkspaceIndexQueryScope::Classes,
            20,
        )
        .map(|envelope| {
            envelope
                .items
                .iter()
                .any(|item| item.title == "ChatP2PViewModel")
        })
        .unwrap_or(false);
        let index_state = runtime.get_index_state(&root_path).unwrap();
        timeline.push((
            batch,
            batch_started.elapsed().as_millis(),
            results
                .iter()
                .map(|result| {
                    (
                        result.kind.clone(),
                        result.status.clone(),
                        result.reason.clone(),
                        result.error.clone(),
                    )
                })
                .collect::<Vec<_>>(),
            class_found,
            (
                format!("{:?}", index_state.status),
                index_state.indexed_at,
                index_state.symbols.len(),
            ),
            manager.indexer_snapshot(),
        ));
        if class_found {
            found_at = Some(started.elapsed().as_millis());
            break;
        }
        if results.is_empty() {
            break;
        }
    }
    fs::remove_dir_all(alias_parent).unwrap();

    assert!(
        found_at.is_some(),
        "packaged-style index pipeline never published ChatP2PViewModel; timeline={timeline:#?}"
    );
}

pub(super) fn resolves_direct_and_inherited_methods() {
    let _cache_guard = FixtureIndexCacheGuard(fixture_root().join(".arkline"));
    let (root, runtime, _) = indexed_fixture();
    let page = root.join("chatkit_ui/src/main/ets/pages/ChatP2PPage.ets");
    let p2p_view_model = root.join("chatkit_ui/src/main/ets/viewmodel/ChatP2PViewModel.ets");
    let base_view_model = root.join("chatkit_ui/src/main/ets/viewmodel/ChatBaseViewModel.ets");

    assert_definition(
        &runtime,
        &root,
        &page,
        1106,
        "loadData",
        &p2p_view_model,
        119,
    );
    assert_definition(
        &runtime,
        &root,
        &page,
        207,
        "sendImageMessage",
        &base_view_model,
        911,
    );
    assert_definition(&runtime, &root, &page, 1102, "init", &p2p_view_model, 66);
}

fn assert_definition(
    runtime: &WorkspaceIndexRuntime,
    root: &Path,
    source: &Path,
    line: u32,
    symbol: &str,
    expected_path: &Path,
    expected_line: u32,
) {
    let content = fs::read_to_string(source).unwrap();
    let source_line = content
        .lines()
        .nth(line as usize - 1)
        .unwrap_or_else(|| panic!("missing line {line} in {}", source.display()));
    let column = source_line
        .find(symbol)
        .unwrap_or_else(|| panic!("missing {symbol} at {}:{line}", source.display()))
        + 1;
    let envelope = query_facade_definition_candidates_with_readiness(
        runtime,
        &root.to_string_lossy(),
        &LanguageQueryRequest {
            path: source.to_string_lossy().to_string(),
            line,
            column: column as u32,
            content: Some(content),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert!(
        envelope.items.iter().any(|candidate| {
            Path::new(&candidate.path) == expected_path && candidate.line == expected_line
        }),
        "definition missed {symbol} at {}:{line}:{column}; expected {}:{expected_line}; candidates={:?}; readiness={:?}",
        source.display(),
        expected_path.display(),
        envelope.items,
        envelope.readiness
    );
}
