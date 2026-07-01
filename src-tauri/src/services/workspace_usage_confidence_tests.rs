use std::fs;

use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_test_fixture_service::{
    create_empty_workspace, create_workspace_source_dir,
};
use crate::services::workspace_usage_query_service::query_usages_with_readiness;

#[test]
fn indexed_usage_results_expose_reference_confidence() {
    let root = create_empty_workspace("usage-query-confidence");
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
    let item = serde_json::to_value(&envelope.items[0]).unwrap();
    assert_eq!(item["kind"], "memberAccess");
    assert_eq!(item["confidence"], "memberResolved");
    fs::remove_dir_all(root).unwrap();
}
