use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn full_refresh_writes_stub_declarations_imports_and_exports() {
    let root = unique_temp_dir("workspace-stub-full");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Index.ets"),
        [
            "import { Foo as Bar } from \"./foo\";",
            "export default struct Index {",
            "  @Builder",
            "  header() {}",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let sqlite_path = sqlite_path(&root);

    assert_eq!(stub_declaration_count(&sqlite_path, "Index"), 1);
    assert_eq!(stub_declaration_count(&sqlite_path, "header"), 1);
    assert_eq!(stub_import_count(&sqlite_path, "./foo", "Bar"), 1);
    assert_eq!(stub_export_count(&sqlite_path, "default"), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_file_refresh_replaces_only_changed_stub_rows() {
    let root = unique_temp_dir("workspace-stub-incremental");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let stable_file = source_dir.join("Stable.ets");
    let changed_file = source_dir.join("Changed.ets");
    fs::write(&stable_file, "class StableController {}\n").unwrap();
    fs::write(&changed_file, "class BeforeChanged {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let sqlite_path = sqlite_path(&root);
    install_stub_delete_probe(&sqlite_path);
    let stable_rowid_before = stub_declaration_rowid(&sqlite_path, "StableController");
    fs::write(&changed_file, "class AfterChanged {}\n").unwrap();

    runtime
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[changed_file.to_string_lossy().to_string()],
        )
        .unwrap();

    assert_eq!(
        stub_declaration_rowid(&sqlite_path, "StableController"),
        stable_rowid_before
    );
    assert_eq!(stub_delete_probe_count(&sqlite_path), 0);
    assert_eq!(stub_declaration_count(&sqlite_path, "BeforeChanged"), 0);
    assert_eq!(stub_declaration_count(&sqlite_path, "AfterChanged"), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn deleted_file_removes_stub_rows() {
    let root = unique_temp_dir("workspace-stub-delete");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let removed_file = source_dir.join("Removed.ets");
    fs::write(&removed_file, "class RemovedController {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    fs::remove_file(&removed_file).unwrap();
    runtime
        .refresh_workspace_index_for_changed_paths(&root_path, &[])
        .unwrap();

    assert_eq!(
        stub_declaration_count(&sqlite_path(&root), "RemovedController"),
        0
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn parser_error_persists_without_blocking_other_files() {
    let root = unique_temp_dir("workspace-stub-parse-error");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(source_dir.join("Good.ets"), "class GoodController {}\n").unwrap();
    fs::write(source_dir.join("Broken.ets"), "struct Broken {\n  build() {\n").unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let sqlite_path = sqlite_path(&root);

    assert_eq!(stub_declaration_count(&sqlite_path, "GoodController"), 1);
    assert_eq!(stub_declaration_count(&sqlite_path, "Broken"), 1);
    assert_eq!(stub_parse_error_count(&sqlite_path, "Unclosed block"), 1);
    assert_eq!(stub_file_status_count(&sqlite_path, "error"), 1);

    fs::remove_dir_all(root).unwrap();
}

fn sqlite_path(root: &PathBuf) -> PathBuf {
    root.join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn install_stub_delete_probe(sqlite_path: &PathBuf) {
    let connection = Connection::open(sqlite_path).unwrap();
    connection
        .execute("create table stub_delete_probe (name text not null)", [])
        .unwrap();
    connection
        .execute(
            "create trigger stable_stub_delete_probe
             before delete on workspace_stub_declarations
             when old.name = 'StableController'
             begin
                insert into stub_delete_probe (name) values (old.name);
             end",
            [],
        )
        .unwrap();
}

fn stub_delete_probe_count(sqlite_path: &PathBuf) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row("select count(*) from stub_delete_probe", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn stub_declaration_rowid(sqlite_path: &PathBuf, name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select rowid from workspace_stub_declarations where name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn stub_declaration_count(sqlite_path: &PathBuf, name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_stub_declarations where name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn stub_import_count(sqlite_path: &PathBuf, source_module: &str, local_name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_stub_imports where source_module = ?1 and local_name = ?2",
            [source_module, local_name],
            |row| row.get(0),
        )
        .unwrap()
}

fn stub_export_count(sqlite_path: &PathBuf, exported_name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_stub_exports where exported_name = ?1",
            [exported_name],
            |row| row.get(0),
        )
        .unwrap()
}

fn stub_parse_error_count(sqlite_path: &PathBuf, message: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_stub_parse_errors where message = ?1",
            [message],
            |row| row.get(0),
        )
        .unwrap()
}

fn stub_file_status_count(sqlite_path: &PathBuf, parse_status: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_stub_files where parse_status = ?1",
            [parse_status],
            |row| row.get(0),
        )
        .unwrap()
}
