use rusqlite::{params, Connection};

pub(crate) fn create_workspace_file_identity_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists workspace_file_identities (
                file_id integer primary key autoincrement,
                root_path text not null,
                path text not null,
                unique(root_path, path)
            );
            create index if not exists workspace_file_identities_lookup
                on workspace_file_identities(root_path, path);",
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn ensure_workspace_file_id(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<i64, String> {
    connection
        .execute(
            "insert or ignore into workspace_file_identities (root_path, path)
             values (?1, ?2)",
            params![root_key, path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .query_row(
            "select file_id from workspace_file_identities
             where root_path = ?1 and path = ?2",
            params![root_key, path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}
