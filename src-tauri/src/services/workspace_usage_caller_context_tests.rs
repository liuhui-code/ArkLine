use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

#[test]
fn usage_results_identify_each_enclosing_caller_function() {
    let root = create_empty_workspace("usage-caller-context");
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
            "function first(service: UserService) {",
            "  service.load();",
            "}",
            "class Page {",
            "  second(service: UserService) {",
            "    service.load();",
            "    service.load();",
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
            path: service_path.to_string_lossy().to_string(),
            line: 2,
            column: 3,
            content: Some(fs::read_to_string(&service_path).unwrap()),
        },
        8,
    )
    .unwrap();

    let callers = envelope
        .items
        .iter()
        .map(|usage| {
            let caller = usage.caller.as_ref().expect("caller context");
            (caller.qualified_name.as_str(), caller.line, usage.line)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        callers,
        vec![
            ("first", 2, 3),
            ("Page.second", 6, 7),
            ("Page.second", 6, 8)
        ]
    );
    fs::remove_dir_all(root).unwrap();
}
