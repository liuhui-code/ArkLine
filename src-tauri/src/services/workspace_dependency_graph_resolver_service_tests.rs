use std::collections::HashSet;

use crate::services::workspace_dependency_graph_resolver_service::{
    is_relative_module, resolve_relative_import,
};

#[test]
fn resolver_matches_relative_source_file_candidates() {
    let files = file_set(&[
        "\\root\\entry\\src\\main\\ets\\model\\Foo.ets",
        "\\root\\entry\\src\\main\\ets\\pages\\Index.ets",
    ]);

    assert_eq!(
        resolve_relative_import(
            "\\root\\entry\\src\\main\\ets\\pages\\Index.ets",
            "../model/Foo",
            &files,
        ),
        Some("\\root\\entry\\src\\main\\ets\\model\\Foo.ets".to_string())
    );
}

#[test]
fn resolver_matches_directory_index_candidates() {
    let files = file_set(&["\\root\\entry\\src\\main\\ets\\model\\index.ets"]);

    assert_eq!(
        resolve_relative_import(
            "\\root\\entry\\src\\main\\ets\\pages\\Index.ets",
            "../model",
            &files,
        ),
        Some("\\root\\entry\\src\\main\\ets\\model\\index.ets".to_string())
    );
}

#[test]
fn resolver_keeps_explicit_source_extension_candidate() {
    let files = file_set(&["\\root\\entry\\src\\main\\ets\\model\\Foo.ts"]);

    assert_eq!(
        resolve_relative_import(
            "\\root\\entry\\src\\main\\ets\\pages\\Index.ets",
            "../model/Foo.ts",
            &files,
        ),
        Some("\\root\\entry\\src\\main\\ets\\model\\Foo.ts".to_string())
    );
}

#[test]
fn relative_module_detection_excludes_package_imports() {
    assert!(is_relative_module("./Foo"));
    assert!(is_relative_module("../Foo"));
    assert!(!is_relative_module("@ohos.router"));
    assert!(!is_relative_module("lodash"));
}

fn file_set(paths: &[&str]) -> HashSet<String> {
    paths.iter().map(|path| path.to_string()).collect()
}
