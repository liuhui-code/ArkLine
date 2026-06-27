use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_service::WorkspaceIndexRuntime;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn indexes_workspace_symbols_for_search_everywhere() {
    let root = unique_temp_dir("workspace-index-symbols");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    fs::write(
        root.join("entry").join("src").join("Login.ets"),
        "class LoginController {\n  private submitLogin() {}\n}\n",
    )
    .unwrap();
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    let state = runtime.refresh_workspace_index(&root_path).unwrap();
    let matches = runtime
        .query_search_everywhere(&root_path, "login", 8)
        .unwrap();

    assert_eq!(state.symbols.len(), 2);
    assert_eq!(matches[0].source, "class");
    assert_eq!(matches[0].title, "LoginController");
    assert_eq!(matches[0].line, Some(1));
    assert_eq!(matches[1].source, "symbol");
    assert_eq!(matches[1].title, "submitLogin");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn search_everywhere_does_not_cap_symbol_results_to_half_the_limit() {
    let root = unique_temp_dir("workspace-index-search-symbol-cap");
    fs::create_dir_all(root.join("entry").join("src")).unwrap();
    for name in [
        "HomeScreen",
        "DetailScreen",
        "SettingsScreen",
        "ProfileScreen",
        "HelpScreen",
    ] {
        fs::write(
            root.join("entry").join("src").join(format!("{name}.ets")),
            format!("class {name} {{}}\n"),
        )
        .unwrap();
    }
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();
    runtime.refresh_workspace_index(&root_path).unwrap();

    let matches = runtime
        .query_search_everywhere(&root_path, "screen", 5)
        .unwrap();

    assert_eq!(
        matches
            .iter()
            .filter(|candidate| candidate.source == "class")
            .count(),
        5
    );

    fs::remove_dir_all(root).unwrap();
}
