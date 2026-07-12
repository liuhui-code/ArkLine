use rusqlite::{params, Connection};

pub(crate) fn insert_unresolved_symbol(
    connection: &Connection,
    root_key: &str,
    path: &str,
    name: &str,
    reason: &str,
    line: i64,
    column: i64,
    indexed_generation: u64,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_unresolved_symbols (
                root_path, path, name, reason, line, column, indexed_generation
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                root_key,
                path,
                name,
                reason,
                line,
                column,
                indexed_generation as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
