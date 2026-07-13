use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::{
    WorkspaceIndexReadinessState, WorkspaceIndexState, WorkspaceIndexStatus,
};
use crate::services::workspace_index_persistence_service::persist_index_state;
use crate::services::workspace_index_query_service::query_definition_candidates_with_readiness;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
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
fn definition_facade_resolves_re_exported_symbol_through_resolved_symbols() {
    let root = unique_temp_dir("workspace-definition-re-export");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let foo_path = source_dir.join("Foo.ets");
    let barrel_path = source_dir.join("Index.ets");
    let app_path = source_dir.join("App.ets");
    fs::write(&foo_path, "export class Foo {\n  load() {}\n}\n").unwrap();
    fs::write(&barrel_path, "export { Foo as PublicFoo } from \"./Foo\"\n").unwrap();
    fs::write(
        &app_path,
        "import { PublicFoo } from \"./Index\"\nconst service = new PublicFoo()\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 2,
            column: 22,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert!(envelope.items.iter().any(|candidate| {
        candidate.path == foo_path.to_string_lossy()
            && candidate.line == 1
            && candidate.preview.contains("Foo")
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
    index_workspace_sdk_symbols(&root_path, &sdk_dir.to_string_lossy(), "12").unwrap();
    runtime.refresh_workspace_index(&root_path).unwrap();

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
fn definition_facade_merges_sdk_and_project_wrapper_member_definitions() {
    let root = unique_temp_dir("workspace-definition-sdk-project-merge");
    let workspace_dir = root.join("workspace");
    let sdk_dir = root.join("sdk");
    let source_dir = workspace_dir
        .join("entry")
        .join("src")
        .join("main")
        .join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(sdk_dir.join("ets")).unwrap();
    let api_path = sdk_dir.join("ets").join("arkui.d.ts");
    fs::write(
        &api_path,
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let wrapper_path = source_dir.join("WrappedText.ets");
    fs::write(
        &wrapper_path,
        "export class Text {\n  width(value: number): Text { return this; }\n}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &app_path,
        [
            "import { Text as WrappedText } from \"./WrappedText\";",
            "const wrapper = new WrappedText();",
            "wrapper.width(12);",
            "Text('hi').width(12);",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = workspace_dir.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    index_workspace_sdk_symbols(&root_path, &sdk_dir.to_string_lossy(), "12").unwrap();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 4,
            column: 12,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert!(envelope
        .items
        .iter()
        .any(|candidate| candidate.path == api_path.to_string_lossy() && candidate.line == 2));
    assert!(envelope.items.iter().any(|candidate| {
        candidate.path == wrapper_path.to_string_lossy() && candidate.line == 2
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
