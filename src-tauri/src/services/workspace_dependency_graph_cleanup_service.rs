use rusqlite::{params, Connection};

pub fn clear_dependency_graph(connection: &Connection, root_key: &str) -> Result<(), String> {
    for table in [
        "workspace_dependency_edges",
        "workspace_dependency_reverse",
        "workspace_unresolved_imports",
    ] {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1"),
                params![root_key],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn clear_dependency_graph_for_path(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_dependency_reverse where root_path = ?1 and from_path = ?2",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_dependency_edges where root_path = ?1 and from_path = ?2",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_unresolved_imports where root_path = ?1 and from_path = ?2",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
