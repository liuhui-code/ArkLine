use std::collections::HashSet;

use crate::services::workspace_dependency_graph_model_service::ImportRow;
use crate::services::workspace_dependency_graph_refresh_plan_service::plan_dependency_refresh_paths;

#[test]
fn skips_changed_paths_without_new_or_existing_dependency_facts() {
    let plan = plan_dependency_refresh_paths(
        &["C:\\workspace\\Plain.ets".to_string()],
        &[],
        &[],
        &HashSet::new(),
        &HashSet::new(),
    );

    assert!(plan.is_empty());
}

#[test]
fn keeps_paths_with_new_import_rows_existing_edges_or_removed_files() {
    let mut existing = HashSet::new();
    existing.insert("C:\\workspace\\HadEdge.ets".to_string());
    let mut removed = HashSet::new();
    removed.insert("C:\\workspace\\Removed.ets".to_string());

    let plan = plan_dependency_refresh_paths(
        &[
            "C:\\workspace\\Imports.ets".to_string(),
            "C:\\workspace\\HadEdge.ets".to_string(),
            "C:\\workspace\\Removed.ets".to_string(),
            "C:\\workspace\\Plain.ets".to_string(),
        ],
        &[ImportRow {
            from_path: "C:\\workspace\\Imports.ets".to_string(),
            source_module: "./Model".to_string(),
            line: 1,
            column: 1,
        }],
        &[],
        &existing,
        &removed,
    );

    assert_eq!(
        plan,
        vec![
            "C:\\workspace\\HadEdge.ets",
            "C:\\workspace\\Imports.ets",
            "C:\\workspace\\Removed.ets",
        ]
    );
}
