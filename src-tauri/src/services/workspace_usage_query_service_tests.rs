use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::models::workspace::WorkspaceIndexReadinessState;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_sdk_index_service::index_workspace_sdk_symbols;
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

#[test]
fn usage_facade_resolves_import_alias_to_indexed_references() {
    let root = create_empty_workspace("usage-query-alias");
    let source_dir = create_workspace_source_dir(&root);
    fs::write(source_dir.join("Foo.ets"), "export class Foo {}\n").unwrap();
    let app_path = source_dir.join("App.ets");
    fs::write(
        &app_path,
        [
            "import { Foo as Bar } from \"./Foo\";",
            "const first = new Bar();",
            "const second = Bar;",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 2,
            column: 19,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    let usages = envelope
        .items
        .iter()
        .map(|usage| (usage.line, usage.column, usage.preview.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(
        envelope.readiness.state,
        WorkspaceIndexReadinessState::Ready
    );
    assert_eq!(
        usages,
        vec![
            (2, 19, "const first = new Bar();"),
            (3, 16, "const second = Bar;"),
        ]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_declaration_caret_to_usage_references() {
    let root = create_empty_workspace("usage-query-declaration");
    let source_dir = create_workspace_source_dir(&root);
    let foo_path = source_dir.join("Foo.ets");
    fs::write(&foo_path, "export class Foo {}\n").unwrap();
    let app_path = source_dir.join("App.ets");
    fs::write(
        &app_path,
        [
            "import { Foo as Bar } from \"./Foo\";",
            "const service = new Bar();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: foo_path.to_string_lossy().to_string(),
            line: 1,
            column: 14,
            content: Some(fs::read_to_string(&foo_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 2);
    assert_eq!(envelope.items[0].column, 21);
    assert_eq!(envelope.items[0].preview, "const service = new Bar();");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_sdk_member_access_caret_to_indexed_references() {
    let root = create_empty_workspace("usage-query-sdk-member");
    let source_dir = create_workspace_source_dir(&root);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let app_path = source_dir.join("Index.ets");
    fs::write(&app_path, "Text('hi').width(12)\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 1,
            column: 12,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 1);
    assert_eq!(envelope.items[0].column, 12);
    assert_eq!(envelope.items[0].preview, "Text('hi').width(12)");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_merges_sdk_and_project_wrapper_member_identities() {
    let root = create_empty_workspace("usage-query-sdk-project-merge");
    let source_dir = create_workspace_source_dir(&root);
    let sdk_root = root.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("arkui.d.ts"),
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
    let root_path = root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&root_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let content = fs::read_to_string(&app_path).unwrap();

    let sdk_envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 4,
            column: 12,
            content: Some(content.clone()),
        },
        8,
    )
    .unwrap();
    let project_envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 3,
            column: 9,
            content: Some(content),
        },
        8,
    )
    .unwrap();

    let expected = vec![
        (3, 9, "wrapper.width(12);"),
        (4, 12, "Text('hi').width(12);"),
    ];
    assert_eq!(
        sdk_envelope
            .items
            .iter()
            .map(|usage| (usage.line, usage.column, usage.preview.as_str()))
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(
        project_envelope
            .items
            .iter()
            .map(|usage| (usage.line, usage.column, usage.preview.as_str()))
            .collect::<Vec<_>>(),
        expected
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_project_member_access_caret_to_indexed_references() {
    let root = create_empty_workspace("usage-query-project-member");
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
        [
            "import { UserService } from \"./UserService\";",
            "const service = new UserService();",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 3,
            column: 9,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 3);
    assert_eq!(envelope.items[0].column, 9);
    assert_eq!(envelope.items[0].preview, "service.load();");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_imported_member_when_same_named_class_exists() {
    let root = create_empty_workspace("usage-query-imported-member-conflict");
    let source_dir = create_workspace_source_dir(&root);
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

    let declaration_envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: target_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            content: Some(fs::read_to_string(&target_path).unwrap()),
        },
        8,
    )
    .unwrap();
    let member_envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 3,
            column: 9,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(declaration_envelope.items.len(), 1);
    assert_eq!(declaration_envelope.items[0].preview, "service.load();");
    assert_eq!(member_envelope.items.len(), 1);
    assert_eq!(member_envelope.items[0].preview, "service.load();");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_project_parameter_member_access_caret_to_indexed_references() {
    let root = create_empty_workspace("usage-query-project-param-member");
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
        [
            "import { UserService } from \"./UserService\";",
            "function run(service: UserService) {",
            "  service.load();",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 3,
            column: 11,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 3);
    assert_eq!(envelope.items[0].column, 11);
    assert_eq!(envelope.items[0].preview, "service.load();");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_project_field_member_access_caret_to_indexed_references() {
    let root = create_empty_workspace("usage-query-project-field-member");
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
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
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 5,
            column: 18,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 5);
    assert_eq!(envelope.items[0].column, 18);
    assert_eq!(envelope.items[0].preview, "this.service.load();");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn usage_facade_resolves_project_return_member_access_caret_to_indexed_references() {
    let root = create_empty_workspace("usage-query-project-return-member");
    let source_dir = create_workspace_source_dir(&root);
    let service_path = source_dir.join("UserService.ets");
    let app_path = source_dir.join("Index.ets");
    fs::write(
        &service_path,
        "export class UserService {\n  load() {}\n}\n",
    )
    .unwrap();
    fs::write(
        &app_path,
        [
            "import { UserService } from \"./UserService\";",
            "function createService(): UserService {",
            "  return new UserService();",
            "}",
            "const service = createService();",
            "service.load();",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let envelope = query_usages_with_readiness(
        &runtime,
        &root_path,
        &LanguageQueryRequest {
            path: app_path.to_string_lossy().to_string(),
            line: 6,
            column: 9,
            content: Some(fs::read_to_string(&app_path).unwrap()),
        },
        8,
    )
    .unwrap();

    assert_eq!(envelope.items.len(), 1);
    assert_eq!(envelope.items[0].line, 6);
    assert_eq!(envelope.items[0].column, 9);
    assert_eq!(envelope.items[0].preview, "service.load();");
    fs::remove_dir_all(root).unwrap();
}
