use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_completion_semantic_service::query_semantic_completions;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};

#[test]
fn semantic_member_completion_excludes_keywords_and_local_symbols() {
    let root = create_empty_workspace("completion-member-only");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService {\n  profile: string = \"\";\n  load() {}\n}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = [
        "import { UserService } from \"./UserService\";",
        "const privateData = \"global-like local\";",
        "const service = new UserService();",
        "service.pr",
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
            line: 4,
            column: 11,
            content: Some(content),
        },
        20,
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].label, "profile");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_chained_dot_completion_does_not_fall_back_to_global_symbols() {
    let root = create_empty_workspace("completion-leading-dot");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Profile.ets"), "export class Profile {}\n").unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = ".Pr";
    fs::write(&app_path, content).unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 4,
            content: Some(content.to_string()),
        },
        20,
    )
    .unwrap();

    assert!(items.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_returns_current_class_members_for_this_receiver() {
    let root = create_empty_workspace("completion-this-member");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("OtherUserPage.ets"),
        "export class UserPage { otherOnly: string = \"\"; }\n",
    )
    .unwrap();
    let app_path = root.join("Index.ets");
    let content = [
        "@Entry",
        "@Component",
        "struct UserPage {",
        "  profile: string = \"\";",
        "  load() {}",
        "  build() { this. }",
        "}",
    ]
    .join("\n");
    fs::write(&app_path, &content).unwrap();
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();

    let line = content.lines().nth(5).unwrap();
    let caret = line.find("this.").unwrap() + "this.".len() + 1;
    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 6,
            column: caret as u32,
            content: Some(content),
        },
        20,
    )
    .unwrap();

    let labels = items
        .iter()
        .map(|item| item.label.as_str())
        .collect::<Vec<_>>();
    assert!(
        labels.contains(&"profile"),
        "current class property should be suggested"
    );
    assert!(
        labels.contains(&"load()"),
        "current class method should be suggested"
    );
    assert!(
        !labels.contains(&"otherOnly"),
        "same-named classes in another file must not leak into this completion"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_resolves_members_through_object_aliases() {
    let root = create_empty_workspace("completion-object-alias");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("UserService.ets"),
        "export class UserService { profile: string = \"\"; load() {} }\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    let content = [
        "import { UserService } from \"./UserService\";",
        "class Page {",
        "  private service: UserService = new UserService();",
        "  run() {",
        "    const current = this.service;",
        "    current.",
        "  }",
        "}",
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
            line: 6,
            column: 13,
            content: Some(content),
        },
        20,
    )
    .unwrap();
    let labels = items
        .iter()
        .map(|item| item.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"profile"));
    assert!(labels.contains(&"load()"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_completion_resolves_decorated_import_members_before_background_indexing() {
    let root = create_empty_workspace("completion-decorated-field");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(
        source_dir.join("EntryViewModel.ets"),
        [
            "export default class EntryViewModel {",
            "  aboutToAppear() {}",
            "  aboutToDisappear() {}",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let app_path = source_dir.join("EntryPage.ets");
    let content = [
        "import EntryViewModel from \"./EntryViewModel\";",
        "@ComponentV2",
        "struct EntryPage {",
        "  @Local vm: EntryViewModel = new EntryViewModel();",
        "  run() { this.vm. }",
        "}",
    ]
    .join("\n");
    fs::write(&app_path, &content).unwrap();
    let root_path = root.to_string_lossy().to_string();

    let items = query_semantic_completions(
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 5,
            column: 19,
            content: Some(content),
        },
        20,
    )
    .unwrap();
    let labels = items
        .iter()
        .map(|item| item.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"aboutToAppear()"));
    assert!(labels.contains(&"aboutToDisappear()"));
    fs::remove_dir_all(root).unwrap();
}
