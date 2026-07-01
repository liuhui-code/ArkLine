use rusqlite::Connection;

pub fn create_symbol_resolution_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_resolved_symbols (
                root_path text not null,
                symbol_id text not null,
                path text not null,
                name text not null,
                qualified_name text not null,
                kind text not null,
                container text,
                signature text,
                visibility text,
                target_symbol_id text,
                source text not null,
                line integer not null,
                column integer not null,
                indexed_generation integer not null,
                primary key (root_path, symbol_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_column(
        connection,
        "workspace_resolved_symbols",
        "target_symbol_id",
        "alter table workspace_resolved_symbols add column target_symbol_id text",
    )?;
    connection
        .execute(
            "create table if not exists workspace_unresolved_symbols (
                root_path text not null,
                path text not null,
                name text not null,
                reason text not null,
                line integer not null,
                column integer not null,
                indexed_generation integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_resolved_symbols_lookup
             on workspace_resolved_symbols(root_path, qualified_name)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_unresolved_symbols_path_lookup
             on workspace_unresolved_symbols(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("pragma table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !columns.iter().any(|existing| existing == column) {
        connection
            .execute(alter_sql, [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
