use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::services::workspace_dependency_graph_service::{
    collect_transitive_reverse_dependencies, has_graph_affecting_config_change,
    load_dependency_graph_status, mark_dependency_graph_stale, query_reverse_dependencies,
    rebuild_dependency_graph,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn resolves_relative_import_to_target_path() {
    let root = fixture_workspace(
        "dependency-relative",
        &[
            (
                "entry/src/main/ets/pages/Index.ets",
                "import { Foo } from \"../model/Foo\";\n",
            ),
            ("entry/src/main/ets/model/Foo.ets", "export class Foo {}\n"),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);
    let from_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Index.ets")
            .to_string_lossy(),
    );
    let to_path = normalize(
        &root
            .join("entry/src/main/ets/model/Foo.ets")
            .to_string_lossy(),
    );
    let files = indexed_files(
        &root,
        &[
            "entry/src/main/ets/pages/Index.ets",
            "entry/src/main/ets/model/Foo.ets",
        ],
    );

    rebuild_dependency_graph(&connection, &root_key, &files).unwrap();

    assert_eq!(edge_count(&connection, &from_path, &to_path), 1);
    assert_eq!(
        query_reverse_dependencies(&connection, &root_key, &to_path).unwrap(),
        vec![from_path]
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn alias_import_still_produces_dependency_edge() {
    let root = fixture_workspace(
        "dependency-alias",
        &[
            (
                "entry/src/main/ets/pages/Index.ets",
                "import { Foo as Bar } from \"../model/Foo\";\n",
            ),
            ("entry/src/main/ets/model/Foo.ets", "export class Foo {}\n"),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);
    let from_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Index.ets")
            .to_string_lossy(),
    );
    let to_path = normalize(
        &root
            .join("entry/src/main/ets/model/Foo.ets")
            .to_string_lossy(),
    );

    rebuild_dependency_graph(
        &connection,
        &root_key,
        &indexed_files(
            &root,
            &[
                "entry/src/main/ets/pages/Index.ets",
                "entry/src/main/ets/model/Foo.ets",
            ],
        ),
    )
    .unwrap();

    assert_eq!(edge_count(&connection, &from_path, &to_path), 1);
    assert_eq!(unresolved_count(&connection), 0);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn directory_index_import_resolves_when_index_file_exists() {
    let root = fixture_workspace(
        "dependency-directory-index",
        &[
            (
                "entry/src/main/ets/pages/Index.ets",
                "import { User } from \"../model\";\n",
            ),
            (
                "entry/src/main/ets/model/index.ets",
                "export class User {}\n",
            ),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);
    let from_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Index.ets")
            .to_string_lossy(),
    );
    let to_path = normalize(
        &root
            .join("entry/src/main/ets/model/index.ets")
            .to_string_lossy(),
    );

    rebuild_dependency_graph(
        &connection,
        &root_key,
        &indexed_files(
            &root,
            &[
                "entry/src/main/ets/pages/Index.ets",
                "entry/src/main/ets/model/index.ets",
            ],
        ),
    )
    .unwrap();

    assert_eq!(edge_count(&connection, &from_path, &to_path), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_target_persists_unresolved_import() {
    let root = fixture_workspace(
        "dependency-unresolved",
        &[(
            "entry/src/main/ets/pages/Index.ets",
            "import { Missing } from \"../model/Missing\";\n",
        )],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);

    rebuild_dependency_graph(
        &connection,
        &root_key,
        &indexed_files(&root, &["entry/src/main/ets/pages/Index.ets"]),
    )
    .unwrap();

    assert_eq!(unresolved_count(&connection), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transitive_reverse_dependency_query_returns_importers() {
    let root = fixture_workspace(
        "dependency-transitive",
        &[
            (
                "entry/src/main/ets/pages/Index.ets",
                "import { Foo } from \"../model/Foo\";\n",
            ),
            (
                "entry/src/main/ets/model/Foo.ets",
                "import { Base } from \"./Base\";\n",
            ),
            (
                "entry/src/main/ets/model/Base.ets",
                "export class Base {}\n",
            ),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);
    let index_path = normalize(
        &root
            .join("entry/src/main/ets/pages/Index.ets")
            .to_string_lossy(),
    );
    let foo_path = normalize(
        &root
            .join("entry/src/main/ets/model/Foo.ets")
            .to_string_lossy(),
    );
    let base_path = normalize(
        &root
            .join("entry/src/main/ets/model/Base.ets")
            .to_string_lossy(),
    );

    rebuild_dependency_graph(
        &connection,
        &root_key,
        &indexed_files(
            &root,
            &[
                "entry/src/main/ets/pages/Index.ets",
                "entry/src/main/ets/model/Foo.ets",
                "entry/src/main/ets/model/Base.ets",
            ],
        ),
    )
    .unwrap();
    let affected =
        collect_transitive_reverse_dependencies(&connection, &root_key, &[base_path], 16).unwrap();

    assert!(affected.contains(&foo_path));
    assert!(affected.contains(&index_path));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_refresh_preserves_unaffected_dependency_edges() {
    let root = fixture_workspace(
        "dependency-incremental-preserve",
        &[
            (
                "entry/src/main/ets/pages/Stable.ets",
                "import { StableModel } from \"../model/StableModel\";\nstruct StablePage {}\n",
            ),
            (
                "entry/src/main/ets/model/StableModel.ets",
                "export class StableModel {}\n",
            ),
            (
                "entry/src/main/ets/pages/Changed.ets",
                "import { ChangedModel } from \"../model/ChangedModel\";\nstruct ChangedPage {}\n",
            ),
            (
                "entry/src/main/ets/model/ChangedModel.ets",
                "export class ChangedModel {}\n",
            ),
        ],
    );
    let root_path = root.to_string_lossy().to_string();
    let stable_page = normalize(
        &root
            .join("entry/src/main/ets/pages/Stable.ets")
            .to_string_lossy(),
    );
    let stable_model = normalize(
        &root
            .join("entry/src/main/ets/model/StableModel.ets")
            .to_string_lossy(),
    );
    let changed_model = root.join("entry/src/main/ets/model/ChangedModel.ets");
    let connection = sqlite_connection(&root);
    install_edge_delete_probe(&connection, &stable_page);

    fs::write(
        &changed_model,
        "export class ChangedModel { next: string }\n",
    )
    .unwrap();
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[changed_model.to_string_lossy().to_string()],
        )
        .unwrap();

    assert_eq!(edge_delete_probe_count(&connection), 0);
    assert_eq!(edge_count(&connection, &stable_page, &stable_model), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn config_change_marks_dependency_graph_stale() {
    let root = fixture_workspace(
        "dependency-config-stale",
        &[("entry/src/main/ets/pages/Index.ets", "struct Index {}\n")],
    );
    let root_path = root.to_string_lossy().to_string();
    let connection = sqlite_connection(&root);
    let root_key = normalize(&root_path);

    rebuild_dependency_graph(
        &connection,
        &root_key,
        &indexed_files(&root, &["entry/src/main/ets/pages/Index.ets"]),
    )
    .unwrap();
    assert_eq!(
        load_dependency_graph_status(&connection, &root_key)
            .unwrap()
            .unwrap()
            .status,
        "ready"
    );
    assert!(has_graph_affecting_config_change(&[root
        .join("oh-package.json5")
        .to_string_lossy()
        .to_string()]));

    mark_dependency_graph_stale(&root_path, "config-change").unwrap();
    let status = load_dependency_graph_status(&connection, &root_key)
        .unwrap()
        .unwrap();

    assert_eq!(status.status, "stale");
    assert_eq!(status.reason.as_deref(), Some("config-change"));

    fs::remove_dir_all(root).unwrap();
}

fn fixture_workspace(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = unique_temp_dir(name);
    for (path, content) in files {
        let file_path = root.join(path);
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(file_path, content).unwrap();
    }
    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root.to_string_lossy())
        .unwrap();
    root
}

fn indexed_files(root: &std::path::Path, files: &[&str]) -> Vec<String> {
    files
        .iter()
        .map(|path| normalize(&root.join(path).to_string_lossy()))
        .collect()
}

fn sqlite_connection(root: &std::path::Path) -> Connection {
    Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap()
}

fn edge_count(connection: &Connection, from_path: &str, to_path: &str) -> i64 {
    connection
        .query_row(
            "select count(*) from workspace_dependency_edges where from_path = ?1 and to_path = ?2",
            [from_path, to_path],
            |row| row.get(0),
        )
        .unwrap()
}

fn unresolved_count(connection: &Connection) -> i64 {
    connection
        .query_row(
            "select count(*) from workspace_unresolved_imports",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn install_edge_delete_probe(connection: &Connection, from_path: &str) {
    connection
        .execute(
            "create table dependency_edge_delete_probe (from_path text not null)",
            [],
        )
        .unwrap();
    connection
        .execute(
            &format!(
                "create trigger dependency_edge_delete_probe_trigger
                 before delete on workspace_dependency_edges
                 when old.from_path = '{}'
                 begin
                    insert into dependency_edge_delete_probe (from_path) values (old.from_path);
                 end",
                sql_literal(from_path),
            ),
            [],
        )
        .unwrap();
}

fn edge_delete_probe_count(connection: &Connection) -> i64 {
    connection
        .query_row(
            "select count(*) from dependency_edge_delete_probe",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn normalize(path: &str) -> String {
    path.replace('/', "\\")
}
