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
fn refresh_workspace_index_persists_symbol_entities() {
    let root = unique_temp_dir("workspace-index-symbol-entities");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    fs::write(
        source_dir.join("Entity.ets"),
        "class EntityController {\n  saveEntity() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();

    WorkspaceIndexRuntime::default()
        .refresh_workspace_index(&root_path)
        .unwrap();
    let connection = Connection::open(
        root.join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite"),
    )
    .unwrap();
    let entities = connection
        .prepare(
            "select source, kind, name, qualified_name, line, column, origin
             from workspace_symbol_entities
             order by source, name",
        )
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(entities.iter().any(|entity| {
        entity.0 == "class"
            && entity.1 == "class"
            && entity.2 == "EntityController"
            && entity.3 == "EntityController"
            && entity.6 == "workspace"
    }));
    assert!(entities.iter().any(|entity| {
        entity.0 == "symbol"
            && entity.1 == "method"
            && entity.2 == "saveEntity"
            && entity.3 == "EntityController.saveEntity"
            && entity.4 == 2
            && entity.5 > 0
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_path_refresh_preserves_unchanged_entity_rows() {
    let root = unique_temp_dir("workspace-index-symbol-entities-incremental");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let stable_file = source_dir.join("Stable.ets");
    let changed_file = source_dir.join("Changed.ets");
    fs::write(&stable_file, "class StableController {}\n").unwrap();
    fs::write(&changed_file, "class BeforeChanged {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let sqlite_path = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    install_entity_delete_probe(&sqlite_path);
    let stable_rowid_before = symbol_entity_rowid(&sqlite_path, "StableController");
    fs::write(&changed_file, "class AfterChanged {}\n").unwrap();

    runtime
        .refresh_workspace_index_for_changed_paths(
            &root_path,
            &[changed_file.to_string_lossy().to_string()],
        )
        .unwrap();
    let stable_rowid_after = symbol_entity_rowid(&sqlite_path, "StableController");
    let stable_delete_count = entity_delete_probe_count(&sqlite_path);
    let before_count = symbol_entity_count(&sqlite_path, "BeforeChanged");
    let after_count = symbol_entity_count(&sqlite_path, "AfterChanged");

    assert_eq!(stable_rowid_after, stable_rowid_before);
    assert_eq!(stable_delete_count, 0);
    assert_eq!(before_count, 0);
    assert_eq!(after_count, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn incremental_entity_failure_rolls_back_sqlite_state() {
    let root = unique_temp_dir("workspace-index-symbol-entities-atomic");
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).unwrap();
    let changed_file = source_dir.join("Broken.ets");
    fs::write(&changed_file, "class BeforeBroken {}\n").unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    runtime.refresh_workspace_index(&root_path).unwrap();
    let sqlite_path = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    install_entity_insert_failure(&sqlite_path);
    fs::write(&changed_file, "class AfterBroken {}\n").unwrap();
    let result = runtime.refresh_workspace_index_for_changed_paths(
        &root_path,
        &[changed_file.to_string_lossy().to_string()],
    );

    assert!(result.is_err());
    assert_eq!(symbol_entity_count(&sqlite_path, "BeforeBroken"), 1);
    assert_eq!(legacy_symbol_count(&sqlite_path, "BeforeBroken"), 1);
    assert_eq!(symbol_entity_count(&sqlite_path, "AfterBroken"), 0);
    assert_eq!(legacy_symbol_count(&sqlite_path, "AfterBroken"), 0);
    assert!(catalog_state_json(&sqlite_path).contains("BeforeBroken"));
    assert!(!catalog_state_json(&sqlite_path).contains("AfterBroken"));

    fs::remove_dir_all(root).unwrap();
}

fn install_entity_insert_failure(sqlite_path: &PathBuf) {
    Connection::open(sqlite_path)
        .unwrap()
        .execute(
            "create trigger entity_insert_failure
             before insert on workspace_symbol_entities
             when new.name = 'AfterBroken'
             begin
                select raise(abort, 'injected entity failure');
             end",
            [],
        )
        .unwrap();
}

fn install_entity_delete_probe(sqlite_path: &PathBuf) {
    let connection = Connection::open(sqlite_path).unwrap();
    connection
        .execute("create table entity_delete_probe (name text not null)", [])
        .unwrap();
    connection
        .execute(
            "create trigger stable_entity_delete_probe
             before delete on workspace_symbol_entities
             when old.name = 'StableController'
             begin
                insert into entity_delete_probe (name) values (old.name);
             end",
            [],
        )
        .unwrap();
}

fn entity_delete_probe_count(sqlite_path: &PathBuf) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row("select count(*) from entity_delete_probe", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn symbol_entity_rowid(sqlite_path: &PathBuf, name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select rowid from workspace_symbol_entities where name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn symbol_entity_count(sqlite_path: &PathBuf, name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_symbol_entities where name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn legacy_symbol_count(sqlite_path: &PathBuf, name: &str) -> i64 {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row(
            "select count(*) from workspace_symbols where name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn catalog_state_json(sqlite_path: &PathBuf) -> String {
    Connection::open(sqlite_path)
        .unwrap()
        .query_row("select state_json from workspace_catalog", [], |row| {
            row.get(0)
        })
        .unwrap()
}
