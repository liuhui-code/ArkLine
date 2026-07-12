use crate::services::workspace_reference_refresh_plan_service::plan_reference_refresh_paths;

#[test]
fn reference_refresh_path_plan_normalizes_sorts_and_dedupes_paths() {
    let plan = plan_reference_refresh_paths(
        &[
            "/repo/src/B.ets".to_string(),
            "/repo/src/A.ets".to_string(),
            "\\repo\\src\\B.ets".to_string(),
        ],
        &[
            "/repo/src/Removed.ets".to_string(),
            "\\repo\\src\\A.ets".to_string(),
        ],
    );

    assert_eq!(
        plan.affected_paths,
        vec![
            "\\repo\\src\\A.ets".to_string(),
            "\\repo\\src\\B.ets".to_string(),
            "\\repo\\src\\Removed.ets".to_string(),
        ]
    );
    assert!(plan.affected_path_set.contains("\\repo\\src\\A.ets"));
    assert!(plan.affected_path_set.contains("\\repo\\src\\B.ets"));
    assert!(plan.affected_path_set.contains("\\repo\\src\\Removed.ets"));
    assert_eq!(plan.affected_path_set.len(), 3);
}
