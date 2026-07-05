use crate::services::workspace_stub_refresh_plan_service::plan_workspace_stub_refresh;

#[test]
fn stub_refresh_plan_normalizes_dedupes_and_splits_path_sets() {
    let plan = plan_workspace_stub_refresh(
        &[
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
            "entry/src/main/ets/Changed.ets".to_string(),
            "entry/src/main/ets/New.ets".to_string(),
        ],
        &[
            "entry\\src\\main\\ets\\Removed.ets".to_string(),
            "entry/src/main/ets/Changed.ets".to_string(),
        ],
    );

    assert_eq!(
        plan.indexed_paths,
        vec![
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
            "entry\\src\\main\\ets\\New.ets".to_string()
        ]
    );
    assert_eq!(
        plan.removed_paths,
        vec![
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
            "entry\\src\\main\\ets\\Removed.ets".to_string()
        ]
    );
    assert_eq!(
        plan.affected_paths,
        vec![
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
            "entry\\src\\main\\ets\\New.ets".to_string(),
            "entry\\src\\main\\ets\\Removed.ets".to_string()
        ]
    );
}

#[test]
fn stub_refresh_plan_keeps_empty_inputs_empty() {
    let plan = plan_workspace_stub_refresh(&[], &[]);

    assert!(plan.indexed_paths.is_empty());
    assert!(plan.removed_paths.is_empty());
    assert!(plan.affected_paths.is_empty());
}
