use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::services::workspace_sdk_index_service::{
    index_workspace_sdk_symbols, query_workspace_sdk_symbols,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-sdk-persistence-{name}-{suffix}"))
}

#[test]
fn sdk_queries_only_use_the_latest_active_sdk_index() {
    let workspace = unique_temp_dir("active-sdk");
    let old_sdk_root = workspace.join("old-openharmony");
    let new_sdk_root = workspace.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class Legacy {\n  oldOnly(value: Length): Legacy;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class Current {\n  currentOnly(value: Length): Current;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&workspace_path, &old_sdk_path, "old-sdk").unwrap();
    assert_eq!(
        query_workspace_sdk_symbols(&workspace_path, "oldOnly", 8)
            .unwrap()
            .len(),
        1
    );

    index_workspace_sdk_symbols(&workspace_path, &new_sdk_path, "new-sdk").unwrap();
    let old_matches = query_workspace_sdk_symbols(&workspace_path, "oldOnly", 8).unwrap();
    let new_matches = query_workspace_sdk_symbols(&workspace_path, "currentOnly", 8).unwrap();

    assert!(old_matches.is_empty());
    assert_eq!(new_matches.len(), 1);
    assert_eq!(new_matches[0].title, "currentOnly");

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn sdk_indexing_prunes_symbols_from_superseded_sdks() {
    let workspace = unique_temp_dir("prune-sdk");
    let old_sdk_root = workspace.join("old-openharmony");
    let new_sdk_root = workspace.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class Legacy {\n  oldOnly(value: Length): Legacy;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class Current {\n  currentOnly(value: Length): Current;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&workspace_path, &old_sdk_path, "old-sdk").unwrap();
    index_workspace_sdk_symbols(&workspace_path, &new_sdk_path, "new-sdk").unwrap();

    assert_eq!(count_persisted_sdk_symbols(&workspace), 2);

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn failed_sdk_indexing_does_not_leave_partial_symbols() {
    let workspace = unique_temp_dir("atomic-sdk");
    let old_sdk_root = workspace.join("old-openharmony");
    let new_sdk_root = workspace.join("new-openharmony");
    fs::create_dir_all(old_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(new_sdk_root.join("ets")).unwrap();
    fs::write(
        old_sdk_root.join("ets").join("old.d.ts"),
        "declare class Legacy {\n  oldOnly(value: Length): Legacy;\n}\n",
    )
    .unwrap();
    fs::write(
        new_sdk_root.join("ets").join("new.d.ts"),
        "declare class Current {\n  currentOnly(value: Length): Current;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let old_sdk_path = old_sdk_root.to_string_lossy().to_string();
    let new_sdk_path = new_sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&workspace_path, &old_sdk_path, "old-sdk").unwrap();
    fail_current_only_sdk_symbol_insert(&workspace);
    let error = index_workspace_sdk_symbols(&workspace_path, &new_sdk_path, "new-sdk").unwrap_err();

    assert!(error.contains("forced sdk insert failure"));
    assert_eq!(count_persisted_sdk_symbols(&workspace), 2);
    assert_eq!(
        query_workspace_sdk_symbols(&workspace_path, "oldOnly", 8)
            .unwrap()
            .len(),
        1
    );
    assert!(
        query_workspace_sdk_symbols(&workspace_path, "currentOnly", 8)
            .unwrap()
            .is_empty()
    );

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn corrupt_shared_sdk_artifact_falls_back_to_workspace_snapshot() {
    let workspace = unique_temp_dir("corrupt-shared-fallback");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("common.d.ts"),
        "declare class TextAttribute {\n  width(value: Length): TextAttribute;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_root.to_string_lossy(), "test-sdk").unwrap();
    let shared_path = workspace
        .join(".arkline")
        .join("index")
        .join("shared-sdk-artifacts.sqlite");
    rusqlite::Connection::open(shared_path)
        .unwrap()
        .execute("drop table shared_sdk_symbols", [])
        .unwrap();

    let matches = query_workspace_sdk_symbols(&workspace_path, "width", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].title, "width");
    fs::remove_dir_all(workspace).unwrap();
}

fn count_persisted_sdk_symbols(workspace: &Path) -> i64 {
    let connection = open_index_connection(workspace);
    connection
        .query_row(
            "select count(*) from workspace_sdk_symbols where root_path = ?1",
            params![workspace.to_string_lossy().replace('/', "\\")],
            |row| row.get(0),
        )
        .unwrap()
}

fn fail_current_only_sdk_symbol_insert(workspace: &Path) {
    let connection = open_index_connection(workspace);
    connection
        .execute(
            "create trigger fail_sdk_symbol_insert
             before insert on workspace_sdk_symbols
             when NEW.name = 'currentOnly'
             begin
                select raise(fail, 'forced sdk insert failure');
             end",
            [],
        )
        .unwrap();
}

fn open_index_connection(workspace: &Path) -> Connection {
    Connection::open(
        workspace
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
}
