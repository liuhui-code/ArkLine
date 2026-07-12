use crate::services::workspace_reference_query_service::{
    bounded_reference_query_limit, reference_catalog_cache_path,
};

#[test]
fn reference_query_limit_is_bounded_for_sql_queries() {
    assert_eq!(bounded_reference_query_limit(0), 1);
    assert_eq!(bounded_reference_query_limit(42), 42);
    assert_eq!(bounded_reference_query_limit(900), 500);
}

#[test]
fn reference_catalog_path_uses_workspace_index_database() {
    let path = reference_catalog_cache_path("/tmp/project");

    assert!(path.ends_with(".arkline/index/workspace-catalog.sqlite"));
}
