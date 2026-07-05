use rusqlite::Connection;

pub fn create_discovery_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_discovered_files (
                root_path text not null,
                path text not null,
                generation integer not null,
                modified_ms integer,
                size_bytes integer,
                excluded integer not null default 0,
                primary key (root_path, path)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_discovery_state (
                root_path text primary key,
                generation integer not null,
                status text not null,
                discovered_count integer not null,
                excluded_count integer not null,
                cursor_json text,
                updated_at_ms integer not null,
                error text
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
