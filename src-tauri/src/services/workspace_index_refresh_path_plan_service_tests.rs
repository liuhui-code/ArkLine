use crate::services::workspace_index_refresh_path_plan_service::plan_workspace_index_refresh_paths;

#[test]
fn refresh_path_plan_sorts_dedupes_and_filters_changed_paths() {
    let plan = plan_workspace_index_refresh_paths(
        &[
            "src/Stable.ets".to_string(),
            "src/Removed.ets".to_string(),
            "src/Duplicate.ets".to_string(),
        ],
        &[
            "src\\Stable.ets".to_string(),
            "src/Added.ets".to_string(),
            "src/Duplicate.ets".to_string(),
            "src/Duplicate.ets".to_string(),
        ],
        &[
            "src/Stable.ets".to_string(),
            "src/Missing.ets".to_string(),
            "src\\Added.ets".to_string(),
            "src/Stable.ets".to_string(),
        ],
    );

    assert_eq!(plan.added_paths, vec!["src\\Added.ets".to_string()]);
    assert_eq!(plan.removed_paths, vec!["src\\Removed.ets".to_string()]);
    assert_eq!(
        plan.direct_content_paths,
        vec!["src\\Added.ets".to_string(), "src\\Stable.ets".to_string()]
    );
    assert_eq!(
        plan.dependency_seed_paths,
        vec![
            "src\\Added.ets".to_string(),
            "src\\Missing.ets".to_string(),
            "src\\Removed.ets".to_string(),
            "src\\Stable.ets".to_string(),
        ]
    );
}

#[test]
fn refresh_path_plan_tracks_empty_previous_index_as_all_added() {
    let plan = plan_workspace_index_refresh_paths(&[], &["src/Entry.ets".to_string()], &[]);

    assert!(plan.previous_paths.is_empty());
    assert_eq!(plan.added_paths, vec!["src\\Entry.ets".to_string()]);
    assert!(plan.removed_paths.is_empty());
}
