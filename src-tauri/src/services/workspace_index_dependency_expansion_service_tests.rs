use std::fs;
use std::path::{Path, PathBuf};
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
fn changed_dependency_reindexes_importer() {
    let root = fixture_workspace(
        "dependency-expansion-change",
        &[
            (
                "entry/src/main/ets/pages/Profile.ets",
                "import { User } from \"../model/User\";\nstruct ProfilePage {}\n",
            ),
            (
                "entry/src/main/ets/model/User.ets",
                "export class User {}\n",
            ),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let profile_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Profile.ets")
            .to_string_lossy(),
    );
    let user_file = root.join("entry/src/main/ets/model/User.ets");
    let sqlite_path = sqlite_path(&root);
    install_stub_delete_probe(&sqlite_path, &profile_path, "ProfilePage");
    fs::write(&user_file, "export class User { renamed: string }\n").unwrap();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[user_file.to_string_lossy().to_string()],
        )
        .unwrap();

    assert_eq!(stub_delete_probe_count(&sqlite_path), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn deleted_import_target_records_unresolved_import_and_reindexes_importer() {
    let root = fixture_workspace(
        "dependency-expansion-delete",
        &[
            (
                "entry/src/main/ets/pages/Profile.ets",
                "import { User } from \"../model/User\";\nstruct ProfilePage {}\n",
            ),
            (
                "entry/src/main/ets/model/User.ets",
                "export class User {}\n",
            ),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let profile_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Profile.ets")
            .to_string_lossy(),
    );
    let user_file = root.join("entry/src/main/ets/model/User.ets");
    let sqlite_path = sqlite_path(&root);
    install_stub_delete_probe(&sqlite_path, &profile_path, "ProfilePage");
    fs::remove_file(&user_file).unwrap();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index_for_changed_paths(&root_path, &[])
        .unwrap();

    assert_eq!(stub_delete_probe_count(&sqlite_path), 1);
    assert_eq!(unresolved_import_count(&sqlite_path, "../model/User"), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn dependency_expansion_cap_falls_back_to_full_refresh() {
    let root = unique_temp_dir("dependency-expansion-cap");
    write_source(
        &root,
        "entry/src/main/ets/model/Base.ets",
        "export class Base {}\n",
    );
    write_source(
        &root,
        "entry/src/main/ets/Unrelated.ets",
        "class Unrelated {}\n",
    );
    for index in 0..501 {
        write_source(
            &root,
            &format!("entry/src/main/ets/pages/Page{index:03}.ets"),
            "import { Base } from \"../model/Base\";\nstruct ImporterPage {}\n",
        );
    }
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();
    let unrelated_path = normalize(
        &root
            .join("entry/src/main/ets/Unrelated.ets")
            .to_string_lossy(),
    );
    let base_file = root.join("entry/src/main/ets/model/Base.ets");
    let sqlite_path = sqlite_path(&root);
    install_stub_delete_probe(&sqlite_path, &unrelated_path, "Unrelated");
    fs::write(&base_file, "export class Base { value: string }\n").unwrap();

    runtime
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[base_file.to_string_lossy().to_string()],
        )
        .unwrap();

    assert_eq!(stub_delete_probe_count(&sqlite_path), 1);

    fs::remove_dir_all(root).unwrap();
}

fn fixture_workspace(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = unique_temp_dir(name);
    for (path, content) in files {
        write_source(&root, path, content);
    }
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root.to_string_lossy())
        .unwrap();
    root
}

fn write_source(root: &Path, path: &str, content: &str) {
    let file_path = root.join(path);
    fs::create_dir_all(file_path.parent().unwrap()).unwrap();
    fs::write(file_path, content).unwrap();
}

fn install_stub_delete_probe(sqlite_path: &Path, path: &str, name: &str) {
    let connection = Connection::open(sqlite_path).unwrap();
    connection
        .execute("create table stub_delete_probe (name text not null)", [])
        .unwrap();
    connection
        .execute(
            &format!(
                "create trigger stub_delete_probe_trigger
             before delete on workspace_stub_declarations
             when old.path = '{}' and old.name = '{}'
             begin
                insert into stub_delete_probe (name) values (old.name);
             end",
                sql_literal(path),
                sql_literal(name),
            ),
            [],
        )
        .unwrap();
}

fn stub_delete_probe_count(sqlite_path: &Path) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row("select count(*) from stub_delete_probe", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn unresolved_import_count(sqlite_path: &Path, source_module: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_unresolved_imports where source_module = ?1",
            [source_module],
            |row| row.get(0),
        )
        .unwrap()
}

fn sqlite_path(root: &Path) -> PathBuf {
    root.join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize(path: &str) -> String {
    path.replace('/', "\\")
}

fn sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}
