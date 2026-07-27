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
