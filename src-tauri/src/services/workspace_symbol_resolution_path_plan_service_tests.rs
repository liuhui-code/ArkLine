use crate::services::workspace_symbol_resolution_path_plan_service::plan_symbol_resolution_paths;

#[test]
fn symbol_resolution_path_plan_normalizes_and_dedupes_affected_paths() {
    let plan = plan_symbol_resolution_paths(
        &[
            "/repo/src/B.ets".to_string(),
            "/repo/src/A.ets".to_string(),
            "\\repo\\src\\B.ets".to_string(),
        ],
        &[
            "/repo/src/Deleted.ets".to_string(),
            "\\repo\\src\\A.ets".to_string(),
        ],
    );

    assert_eq!(
        plan.affected_paths,
        vec![
            "\\repo\\src\\A.ets".to_string(),
            "\\repo\\src\\B.ets".to_string(),
            "\\repo\\src\\Deleted.ets".to_string(),
        ]
    );
    assert!(plan.affected_path_set.contains("\\repo\\src\\A.ets"));
    assert!(plan.affected_path_set.contains("\\repo\\src\\B.ets"));
    assert!(plan.affected_path_set.contains("\\repo\\src\\Deleted.ets"));
    assert_eq!(plan.affected_path_set.len(), 3);
}
