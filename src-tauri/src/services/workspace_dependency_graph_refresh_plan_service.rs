use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::services::workspace_dependency_graph_model_service::ImportRow;

pub(crate) fn plan_dependency_refresh_paths(
    affected_paths: &[String],
    import_rows: &[ImportRow],
    export_rows: &[ImportRow],
    existing_dependency_paths: &HashSet<String>,
    removed_paths: &HashSet<String>,
) -> Vec<String> {
    let mut row_paths = import_rows
        .iter()
        .chain(export_rows.iter())
        .map(|row| row.from_path.as_str())
        .collect::<HashSet<_>>();
    let mut planned = affected_paths
        .iter()
        .filter(|path| {
            row_paths.contains(path.as_str())
                || existing_dependency_paths.contains(path.as_str())
                || removed_paths.contains(path.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    planned.sort();
    planned.dedup();
    row_paths.clear();
    planned
}

pub(crate) fn load_dependency_fact_paths(
    connection: &Connection,
    root_key: &str,
    affected_paths: &HashSet<String>,
) -> Result<HashSet<String>, String> {
    let mut paths = HashSet::new();
    let mut statement = connection
        .prepare(
            "select from_path from workspace_dependency_edges where root_path = ?1 and from_path = ?2
             union
             select from_path from workspace_unresolved_imports where root_path = ?1 and from_path = ?2",
        )
        .map_err(|error| error.to_string())?;
    for path in affected_paths {
        let rows = statement
            .query_map(params![root_key, path], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for row in rows {
            paths.insert(row.map_err(|error| error.to_string())?);
        }
    }
    Ok(paths)
}
