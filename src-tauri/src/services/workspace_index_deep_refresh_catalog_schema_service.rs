use rusqlite::Connection;

pub(crate) fn create_deep_refresh_catalog_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists workspace_index_deep_refresh_catalogs (
                root_path text not null,
                catalog_generation integer not null,
                state text not null,
                created_at integer not null,
                superseded_at integer,
                primary key (root_path, catalog_generation)
            );
            create table if not exists workspace_index_deep_refresh_catalog_files (
                root_path text not null,
                catalog_generation integer not null,
                file_id integer not null,
                path text not null,
                primary key (root_path, catalog_generation, file_id),
                unique (root_path, catalog_generation, path)
            );
            create index if not exists workspace_index_deep_refresh_catalog_files_lookup
                on workspace_index_deep_refresh_catalog_files(
                    root_path, catalog_generation, file_id
                );
            create table if not exists workspace_index_deep_refresh_checkpoints (
                root_path text not null,
                task_key text not null,
                catalog_generation integer not null,
                phase text not null,
                last_file_id integer not null,
                batch_last_file_id integer,
                updated_at integer not null,
                primary key (root_path, task_key)
            );
            create index if not exists workspace_index_deep_refresh_checkpoints_lookup
                on workspace_index_deep_refresh_checkpoints(root_path, catalog_generation);",
        )
        .map_err(|error| error.to_string())
}
