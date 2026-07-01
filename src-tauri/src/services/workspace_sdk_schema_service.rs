use rusqlite::Connection;

pub fn create_sdk_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_sdk_symbols (
                root_path text not null,
                sdk_path text not null,
                sdk_version text not null,
                source text not null,
                kind text not null,
                name text not null,
                path text not null,
                line integer not null,
                column integer not null,
                container text,
                signature text,
                primary key (root_path, sdk_path, sdk_version, kind, name, path, line, column)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_column(
        connection,
        "workspace_sdk_symbols",
        "symbol_id",
        "alter table workspace_sdk_symbols add column symbol_id text",
    )?;
    connection
        .execute(
            "update workspace_sdk_symbols
             set symbol_id = 'sdk:' || path || ':' || kind || ':' ||
                 coalesce(container, '') || ':' || name || ':' || line || ':' || column
             where symbol_id is null",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_sdk_symbols_lookup
             on workspace_sdk_symbols(root_path, name, kind)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_sdk_symbols_symbol_id_lookup
             on workspace_sdk_symbols(root_path, symbol_id)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_sdk_index_metadata (
                root_path text primary key,
                sdk_path text not null,
                sdk_version text not null,
                indexed_at integer not null
            )",
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
