use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_completion_semantic_service::{
    query_semantic_completions, query_semantic_completions_with_readiness,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;

#[test]
fn semantic_completion_returns_arkts_keywords_by_prefix() {
    let root = create_empty_workspace("completion-keywords");
    let request = LanguageQueryRequest {
        path: root.join("Index.ets").to_string_lossy().to_string(),
        line: 1,
        column: 4,
        content: Some("pri".to_string()),
    };

    let items = query_semantic_completions(&root.to_string_lossy(), &request, 20).unwrap();
    let labels = labels(&items);

    assert_eq!(labels, vec!["private"]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_visibility_and_modifier_keywords() {
    let root = create_empty_workspace("completion-visibility-keywords");
    let root_path = root.to_string_lossy().to_string();

    for (prefix, expected) in [
        ("pub", "public"),
        ("pri", "private"),
        ("pro", "protected"),
        ("rea", "readonly"),
        ("sta", "static"),
    ] {
        let request = LanguageQueryRequest {
            path: root.join("Index.ets").to_string_lossy().to_string(),
            line: 1,
            column: u32::try_from(prefix.len() + 1).unwrap(),
            content: Some(prefix.to_string()),
        };
        let items = query_semantic_completions(&root_path, &request, 20).unwrap();
        assert!(
            labels(&items).contains(&expected),
            "{expected} should be suggested for {prefix}"
        );
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_snippets_after_language_keywords() {
    let root = create_empty_workspace("completion-snippets");
    let request = LanguageQueryRequest {
        path: root.join("Index.ets").to_string_lossy().to_string(),
        line: 1,
        column: 3,
        content: Some("st".to_string()),
    };

    let items = query_semantic_completions(&root.to_string_lossy(), &request, 20).unwrap();
    let labels = labels(&items);
    let keyword_index = labels
        .iter()
        .position(|label| *label == "struct")
        .expect("struct keyword should be suggested");
    let snippet_index = labels
        .iter()
        .position(|label| *label == "struct component")
        .expect("struct component snippet should be suggested");

    assert!(keyword_index < snippet_index);
    let snippet = items
        .iter()
        .find(|item| item.label == "struct component")
        .unwrap();
    assert_eq!(snippet.kind, "snippet");
    assert_eq!(snippet.source.as_deref(), Some("arkts"));
    assert!(snippet
        .insert_text
        .as_deref()
        .unwrap()
        .contains("struct ${1:Index}"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_with_readiness_returns_index_envelope() {
    let root = create_empty_workspace("completion-readiness-envelope");
    let app_path = root.join("Index.ets");
    fs::write(&app_path, "pri").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_semantic_completions_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 4,
            content: Some("pri".to_string()),
        },
        20,
    )
    .unwrap();

    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(labels(&envelope.items), vec!["private"]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_local_scope_candidates() {
    let root = create_empty_workspace("completion-local-scope");
    let request = LanguageQueryRequest {
        path: root.join("Index.ets").to_string_lossy().to_string(),
        line: 3,
        column: 3,
        content: Some(["const localService = 1;", "function loadUser() {}", "lo"].join("\n")),
    };

    let items = query_semantic_completions(&root.to_string_lossy(), &request, 20).unwrap();
    let labels = labels(&items);

    assert!(labels.contains(&"localService"));
    assert!(labels.contains(&"loadUser()"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_keeps_local_candidates_before_workspace_symbols() {
    let root = create_empty_workspace("completion-local-before-workspace");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("LocalService.ets"),
        "export class localService {}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = ["const localService = createLocal();", "lo"].join("\n");
    fs::write(&app_path, &content).unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            content: Some(content),
        },
        20,
    )
    .unwrap();

    let local_index = items
        .iter()
        .position(|item| item.label == "localService" && item.source.as_deref() == Some("local"))
        .expect("local candidate should be suggested");
    let workspace_index = items
        .iter()
        .position(|item| {
            item.label == "localService" && item.source.as_deref() == Some("workspace")
        })
        .expect("workspace candidate should be suggested");

    assert!(local_index < workspace_index);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_member_candidates_for_receiver_context() {
    let root = create_empty_workspace("completion-member");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = [
        "import { UserService } from \"./UserService\";",
        "const service = new UserService();",
        "service.",
    ]
    .join("\n");
    fs::write(&app_path, &content).unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 3,
            column: 9,
            content: Some(content),
        },
        20,
    )
    .unwrap();

    assert_eq!(labels(&items), vec!["load()"]);
    assert_eq!(items[0].kind, "method");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_importable_project_symbols_with_metadata() {
    let root = create_empty_workspace("completion-importable-project");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    fs::write(&app_path, "User").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 5,
            content: Some("User".to_string()),
        },
        20,
    )
    .unwrap();

    let service = items
        .iter()
        .find(|item| item.label == "UserService")
        .expect("project symbol should be suggested");
    assert_eq!(service.kind, "class");
    assert_eq!(service.source.as_deref(), Some("workspace"));
    assert!(service.data.as_ref().unwrap()["symbolId"]
        .as_str()
        .unwrap()
        .starts_with("project:"));
    assert!(service.data.as_ref().unwrap()["importPath"]
        .as_str()
        .unwrap()
        .ends_with("UserService.ets"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_active_sdk_api_candidates() {
    let root = create_empty_workspace("completion-sdk");
    let source_dir = create_workspace_source_dir(&root);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(source_dir.join("Index.ets"), "Text").unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: source_dir.join("Index.ets").to_string_lossy().to_string(),
            line: 1,
            column: 5,
            content: Some("Text".to_string()),
        },
        20,
    )
    .unwrap();

    let text = items
        .iter()
        .find(|item| item.label == "Text" && item.source.as_deref() == Some("sdk"))
        .expect("SDK API should be suggested");
    assert_eq!(text.kind, "class");
    assert_eq!(text.source.as_deref(), Some("sdk"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_sdk_members_for_inline_receiver_prefix() {
    let root = create_empty_workspace("completion-sdk-members");
    let source_dir = create_workspace_source_dir(&root);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = "Text().wi";
    fs::write(&app_path, content).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n  fontSize(value: number): Text;\n}\ndeclare function widthGlobal(): void;\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 10,
            content: Some(content.to_string()),
        },
        20,
    )
    .unwrap();

    let width = items
        .iter()
        .find(|item| item.label == "width" && item.source.as_deref() == Some("sdk"))
        .expect("SDK receiver member should be suggested");
    assert_eq!(width.kind, "method");
    assert!(width.detail.contains("width(value: Length)"));
    assert!(!items
        .iter()
        .any(|item| item.label == "widthGlobal" && item.source.as_deref() == Some("sdk")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_deduplicates_by_symbol_identity_before_label() {
    let root = create_empty_workspace("completion-dedupe");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    let app_path = source_dir.join("Index.ets");
    fs::write(&app_path, "import { Foo as LocalFoo } from \"./Foo\";\nFoo").unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 2,
            column: 4,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        20,
    )
    .unwrap();
    let foo_count = items.iter().filter(|item| item.label == "Foo").count();

    assert_eq!(foo_count, 1);
    fs::remove_dir_all(root).unwrap();
}

fn labels(items: &[crate::models::language::CompletionItem]) -> Vec<&str> {
    items.iter().map(|item| item.label.as_str()).collect()
}
