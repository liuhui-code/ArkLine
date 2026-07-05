use crate::services::workspace_incremental_path_plan_service::plan_incremental_index_paths;

#[test]
fn incremental_path_plan_normalizes_dedupes_and_splits_sets() {
    let plan = plan_incremental_index_paths(
        &[
            "entry/src/main/ets/Changed.ets".to_string(),
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
            "entry/src/main/ets/New.ets".to_string(),
        ],
        &[
            "entry/src/main/ets/Removed.ets".to_string(),
            "entry\\src\\main\\ets\\Changed.ets".to_string(),
        ],
    );

    assert_eq!(
        plan.changed_paths,
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
fn incremental_path_plan_keeps_empty_inputs_empty() {
    let plan = plan_incremental_index_paths(&[], &[]);

    assert!(plan.changed_paths.is_empty());
    assert!(plan.removed_paths.is_empty());
    assert!(plan.affected_paths.is_empty());
}
