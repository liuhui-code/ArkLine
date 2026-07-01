use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::language::{DefinitionCandidate, LanguageQueryRequest};
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
fn definition_facade_prefers_resolved_sdk_member_reference_at_caret() {
    let root = unique_temp_dir("workspace-definition-sdk-member-reference");
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
        [
            "declare class Text {",
            "  width(value: Length): Text;",
            "}",
            "declare class Button {",
            "  width(value: Length): Button;",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = workspace_dir.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&root_path, &sdk_dir.to_string_lossy(), "12").unwrap();
    let runtime = WorkspaceIndexRuntime::default();
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
        envelope.items,
        vec![DefinitionCandidate {
            path: api_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            preview: "width(value: Length): Text;".to_string(),
        }]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn definition_facade_resolves_project_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-member-reference",
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.load();",
        ]
        .join("\n"),
        3,
        9,
    );
}

#[test]
fn definition_facade_resolves_imported_member_when_same_named_class_exists() {
    let root = unique_temp_dir("workspace-definition-imported-member-conflict");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(source_dir.join("afeature")).unwrap();
    fs::create_dir_all(source_dir.join("zfeature")).unwrap();
    let target_path = source_dir.join("zfeature").join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(&target_path, "export class UserService {\n  load() {}\n}\n").unwrap();
    fs::write(
        source_dir.join("afeature").join("UserService.ets"),
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
        [
            "import { UserService as ActiveService } from \"./zfeature/UserService\";",
            "const service = new ActiveService();",
            "service.load();",
        ]
        .join("\n"),
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
            line: 3,
            column: 9,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        envelope.items,
        vec![DefinitionCandidate {
            path: target_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            preview: "load()".to_string(),
        }]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn definition_facade_resolves_project_parameter_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-param-member",
        [
            "import { UserService } from \"./UserService\";",
            "function run(service: UserService) {",
            "  service.load();",
            "}",
        ]
        .join("\n"),
        3,
        11,
    );
}

#[test]
fn definition_facade_resolves_project_field_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-field-member",
        [
            "import { UserService } from \"./UserService\";",
            "class PageController {",
            "  private service: UserService = new UserService();",
            "  run() {",
            "    this.service.load();",
            "  }",
            "}",
        ]
        .join("\n"),
        5,
        18,
    );
}

#[test]
fn definition_facade_resolves_project_return_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-return-member",
        [
            "import { UserService } from \"./UserService\";",
            "function createService(): UserService {",
            "  return new UserService();",
            "}",
            "const service = createService();",
            "service.load();",
        ]
        .join("\n"),
        6,
        9,
    );
}

#[test]
fn definition_facade_resolves_project_async_promise_return_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-async-promise-return-member",
        [
            "import { UserService } from \"./UserService\";",
            "async function createService(): Promise<UserService> {",
            "  return new UserService();",
            "}",
            "const service = await createService();",
            "service.load();",
        ]
        .join("\n"),
        6,
        9,
    );
}

#[test]
fn definition_facade_resolves_project_generic_field_member_reference_at_caret() {
    assert_project_member_definition(
        "workspace-definition-project-generic-field-member",
        [
            "import { UserService } from \"./UserService\";",
            "class Box<T> {",
            "  value: T;",
            "}",
            "const box: Box<UserService>;",
            "box.value.load();",
        ]
        .join("\n"),
        6,
        11,
    );
}

fn assert_project_member_definition(name: &str, app_content: String, line: u32, column: u32) {
    let root = unique_temp_dir(name);
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(&app_path, app_content).unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_definition_candidates_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line,
            column,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        None,
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        envelope.items,
        vec![DefinitionCandidate {
            path: service_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            preview: "load()".to_string(),
        }]
    );
    fs::remove_dir_all(root).unwrap();
}
