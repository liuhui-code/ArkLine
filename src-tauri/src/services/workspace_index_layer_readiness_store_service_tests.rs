use rusqlite::{params, Connection};

use crate::services::workspace_index_layer_readiness_store_service::{
    count_distinct_paths, count_rows, normalize_layer_index_path, row_exists,
};

#[test]
fn counts_rows_and_distinct_paths_for_a_root() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute(
            "create table workspace_content_lines (
                root_path text not null,
                path text not null,
                line integer not null
             )",
            [],
        )
        .unwrap();
    for (root, path, line) in [
        ("/root", "src/A.ets", 1_i64),
        ("/root", "src/A.ets", 2_i64),
        ("/root", "src/B.ets", 1_i64),
        ("/other", "src/C.ets", 1_i64),
    ] {
        connection
            .execute(
                "insert into workspace_content_lines (root_path, path, line)
                 values (?1, ?2, ?3)",
                params![root, path, line],
            )
            .unwrap();
    }

    assert_eq!(
        count_rows(&connection, "workspace_content_lines", "/root").unwrap(),
        3
    );
    assert_eq!(
        count_distinct_paths(&connection, "workspace_content_lines", "/root").unwrap(),
        2
    );
}

#[test]
fn row_exists_filters_by_root_and_normalized_path() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute(
            "create table workspace_files (
                root_path text not null,
                path text not null
             )",
            [],
        )
        .unwrap();
    connection
        .execute(
            "insert into workspace_files (root_path, path) values (?1, ?2)",
            params!["/root", "src\\Entry.ets"],
        )
        .unwrap();

    assert!(row_exists(&connection, "workspace_files", "/root", "src\\Entry.ets").unwrap());
    assert!(!row_exists(&connection, "workspace_files", "/root", "src\\Missing.ets").unwrap());
    assert!(!row_exists(&connection, "workspace_files", "/other", "src\\Entry.ets").unwrap());
}

#[test]
fn normalize_layer_index_path_uses_index_separator() {
    assert_eq!(
        normalize_layer_index_path("/workspace/src/Entry.ets"),
        "\\workspace\\src\\Entry.ets"
    );
}
