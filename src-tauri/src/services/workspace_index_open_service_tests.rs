use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::models::workspace::{WorkspaceScanSummary, WorkspaceSnapshot};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn snapshot(root_path: &str) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        root_name: "ArkDemo".to_string(),
        root_path: root_path.to_string(),
        files: vec![
            format!("{root_path}/entry/src/main/ets/pages/Index.ets"),
            format!("{root_path}/entry/src/main/ets/components/IndexCard.ets"),
            format!("{root_path}/AppScope/app.json5"),
        ],
        scan_summary: WorkspaceScanSummary {
            scanned_files: 3,
            skipped_entries: 0,
            truncated: false,
            exclude_rules: vec![".git".to_string(), "node_modules".to_string()],
        },
    }
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn indexes_workspace_snapshot_for_open_without_deep_stub_or_symbol_rows() {
    let root = unique_temp_dir("workspace-index-open-light");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Login.ets"),
        "export class LoginController {}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    let state = runtime
        .index_workspace_snapshot_for_open(&snapshot(&root_path))
        .unwrap();

    let matches = runtime.query_quick_open(&root_path, "index", 8).unwrap();
    let sqlite_file = root
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite");
    let connection = Connection::open(&sqlite_file).unwrap();
    let file_count: i64 = connection
        .query_row("select count(*) from workspace_files", [], |row| row.get(0))
        .unwrap();
    let stub_count: i64 = connection
        .query_row("select count(*) from workspace_stub_files", [], |row| {
            row.get(0)
        })
        .unwrap();
    let symbol_count: i64 = connection
        .query_row("select count(*) from workspace_symbols", [], |row| {
            row.get(0)
        })
        .unwrap();

    assert_eq!(state.status.to_string(), "ready");
    assert!(state.symbols.is_empty());
    assert_eq!(matches[0].title, "Index.ets");
    assert_eq!(file_count, 3);
    assert_eq!(stub_count, 0);
    assert_eq!(symbol_count, 0);

    fs::remove_dir_all(root).unwrap();
}
