use std::fs;

use crate::services::workspace_reference_refresh_plan_service::{
    plan_reference_refresh_content, plan_reference_refresh_content_with_budget,
    plan_reference_refresh_paths, ReferenceRefreshContentBudget,
};

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

#[test]
fn reference_refresh_content_plan_reads_source_files_and_detects_member_access() {
    let root = std::env::temp_dir().join(format!(
        "arkline-reference-refresh-content-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create temp root");
    let source = root.join("Entry.ets");
    let script = root.join("Helper.ts");
    let notes = root.join("README.md");
    fs::write(&source, "class Entry { run() { this.service.start(); } }").expect("write source");
    fs::write(&script, "export const helper = 1;").expect("write script");
    fs::write(&notes, "this.shouldNotBeRead").expect("write notes");

    let plan = plan_reference_refresh_content(&[
        source.to_string_lossy().to_string(),
        script.to_string_lossy().to_string(),
        notes.to_string_lossy().to_string(),
    ]);

    assert_eq!(plan.contents.len(), 2);
    assert!(plan
        .contents
        .contains_key(&source.to_string_lossy().replace('/', "\\")));
    assert!(plan
        .contents
        .contains_key(&script.to_string_lossy().replace('/', "\\")));
    assert!(!plan
        .contents
        .contains_key(&notes.to_string_lossy().replace('/', "\\")));
    assert!(plan.member_context_required);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn reference_refresh_content_plan_skips_sources_over_file_budget() {
    let root = temp_reference_root("file-budget");
    let small = root.join("Small.ets");
    let large = root.join("Large.ets");
    fs::write(&small, "class Small {}").expect("write small source");
    fs::write(&large, "class Large { run() { this.service.start(); } }")
        .expect("write large source");

    let plan = plan_reference_refresh_content_with_budget(
        &[
            small.to_string_lossy().to_string(),
            large.to_string_lossy().to_string(),
        ],
        ReferenceRefreshContentBudget {
            max_file_bytes: 20,
            max_total_bytes: 200,
        },
    );

    assert_eq!(plan.contents.len(), 1);
    assert!(plan
        .contents
        .contains_key(&small.to_string_lossy().replace('/', "\\")));
    assert_eq!(
        plan.skipped_oversized_paths,
        vec![large.to_string_lossy().replace('/', "\\")]
    );
    assert!(!plan.member_context_required);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn reference_refresh_content_plan_skips_sources_over_total_budget() {
    let root = temp_reference_root("total-budget");
    let first = root.join("First.ets");
    let second = root.join("Second.ets");
    fs::write(&first, "class First {}").expect("write first source");
    fs::write(&second, "class Second {}").expect("write second source");

    let plan = plan_reference_refresh_content_with_budget(
        &[
            first.to_string_lossy().to_string(),
            second.to_string_lossy().to_string(),
        ],
        ReferenceRefreshContentBudget {
            max_file_bytes: 200,
            max_total_bytes: 20,
        },
    );

    assert_eq!(plan.contents.len(), 1);
    assert_eq!(
        plan.skipped_oversized_paths,
        vec![second.to_string_lossy().replace('/', "\\")]
    );

    let _ = fs::remove_dir_all(root);
}

fn temp_reference_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "arkline-reference-refresh-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create temp root");
    root
}
