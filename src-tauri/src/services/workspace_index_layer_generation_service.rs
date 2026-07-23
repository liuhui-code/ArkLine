use rusqlite::{params, Connection, OptionalExtension};

use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;

pub(crate) const CONTENT_LAYER: &str = "content";
pub(crate) const STUB_LAYER: &str = "stub";

pub(crate) fn create_layer_generation_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_layer_generations (
                root_path text not null,
                layer text not null,
                indexed_generation integer not null,
                updated_at integer not null,
                primary key (root_path, layer)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn reject_stale_layer_generation(
    connection: &Connection,
    root_key: &str,
    layer: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    let newest = load_layer_generation(connection, root_key, layer)?.unwrap_or_default();
    if newest > indexed_generation {
        return Err(format!(
            "Stale {layer} refresh generation {indexed_generation}; newest persisted generation is {newest}"
        ));
    }
    Ok(())
}

pub(crate) fn publish_layer_generation(
    connection: &Connection,
    root_key: &str,
    layer: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    reject_stale_layer_generation(connection, root_key, layer, indexed_generation)?;
    let generation = i64::try_from(indexed_generation)
        .map_err(|_| "Index layer generation exceeds SQLite integer range".to_string())?;
    connection
        .execute(
            "insert into workspace_index_layer_generations (
                root_path, layer, indexed_generation, updated_at
             ) values (?1, ?2, ?3, strftime('%s','now') * 1000)
             on conflict(root_path, layer) do update set
                indexed_generation = excluded.indexed_generation,
                updated_at = excluded.updated_at",
            params![root_key, layer, generation],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn latest_layer_generation(root_path: &str, layer: &str) -> Result<Option<u64>, String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(None);
    };
    load_layer_generation(&connection, &root_path.replace('/', "\\"), layer)
}

fn load_layer_generation(
    connection: &Connection,
    root_key: &str,
    layer: &str,
) -> Result<Option<u64>, String> {
    let table_exists = connection
        .query_row(
            "select 1 from sqlite_master
             where type = 'table' and name = 'workspace_index_layer_generations'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    if !table_exists {
        return Ok(None);
    }
    connection
        .query_row(
            "select indexed_generation from workspace_index_layer_generations
             where root_path = ?1 and layer = ?2 limit 1",
            params![root_key, layer],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map(|value| value.and_then(|generation| u64::try_from(generation).ok()))
        .map_err(|error| error.to_string())
}
