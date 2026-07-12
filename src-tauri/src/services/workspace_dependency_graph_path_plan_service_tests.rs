use crate::services::workspace_dependency_graph_path_plan_service::plan_dependency_graph_paths;

#[test]
fn dependency_graph_path_plan_normalizes_sorts_and_dedupes_changed_paths() {
    let plan = plan_dependency_graph_paths(
        &[
            "/root/entry/src/main/ets/pages/Index.ets".to_string(),
            "\\root\\entry\\src\\main\\ets\\pages\\Index.ets".to_string(),
            "/root/entry/src/main/ets/model/Foo.ets".to_string(),
        ],
        &[
            "/root/entry/src/main/ets/pages/Removed.ets".to_string(),
            "/root/entry/src/main/ets/model/Foo.ets".to_string(),
        ],
    );

    assert_eq!(
        plan.affected_paths,
        vec![
            "\\root\\entry\\src\\main\\ets\\model\\Foo.ets",
            "\\root\\entry\\src\\main\\ets\\pages\\Index.ets",
            "\\root\\entry\\src\\main\\ets\\pages\\Removed.ets",
        ]
    );
    assert!(plan
        .affected_path_set
        .contains("\\root\\entry\\src\\main\\ets\\pages\\Index.ets"));
    assert!(plan
        .removed_path_set
        .contains("\\root\\entry\\src\\main\\ets\\model\\Foo.ets"));
}
