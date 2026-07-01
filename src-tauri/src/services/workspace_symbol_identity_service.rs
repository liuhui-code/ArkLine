pub fn project_symbol_id(
    path: &str,
    kind: &str,
    qualified_name: &str,
    line: i64,
    column: i64,
) -> String {
    format!("project:{path}:{kind}:{qualified_name}:{line}:{column}")
}

pub fn sdk_symbol_id(
    path: &str,
    kind: &str,
    container: Option<&str>,
    name: &str,
    line: i64,
    column: i64,
) -> String {
    format!(
        "sdk:{}:{}:{}:{}:{}:{}",
        path,
        kind,
        container.unwrap_or_default(),
        name,
        line,
        column
    )
}
