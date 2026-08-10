use rusqlite::Connection;

pub(crate) fn create_resume_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_resume_tasks (
                root_path text not null,
                task_key text not null,
                kind text not null,
                priority integer not null,
                reason text not null,
                generation integer not null,
                changed_paths_json text not null,
                updated_at integer not null,
                primary key (root_path, task_key)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_index_resume_tasks_lookup
             on workspace_index_resume_tasks(root_path, priority, generation)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
