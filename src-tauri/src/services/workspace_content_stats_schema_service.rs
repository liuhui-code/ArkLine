use rusqlite::{params, Connection, OptionalExtension};

pub(crate) fn create_content_stats_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists workspace_content_stats (
                root_path text primary key,
                ready_count integer not null default 0 check (ready_count >= 0),
                failed_count integer not null default 0 check (failed_count >= 0)
            );
            create trigger if not exists workspace_content_stats_insert
            after insert on workspace_content_files
            begin
                insert into workspace_content_stats (
                    root_path, ready_count, failed_count
                ) values (
                    new.root_path,
                    case when new.status = 'ready' then 1 else 0 end,
                    case when new.status = 'failed' then 1 else 0 end
                )
                on conflict(root_path) do update set
                    ready_count = ready_count + excluded.ready_count,
                    failed_count = failed_count + excluded.failed_count;
            end;
            create trigger if not exists workspace_content_stats_delete
            after delete on workspace_content_files
            begin
                update workspace_content_stats set
                    ready_count = ready_count
                        - case when old.status = 'ready' then 1 else 0 end,
                    failed_count = failed_count
                        - case when old.status = 'failed' then 1 else 0 end
                where root_path = old.root_path;
            end;
            create trigger if not exists workspace_content_stats_update
            after update of root_path, status on workspace_content_files
            begin
                update workspace_content_stats set
                    ready_count = ready_count
                        - case when old.status = 'ready' then 1 else 0 end,
                    failed_count = failed_count
                        - case when old.status = 'failed' then 1 else 0 end
                where root_path = old.root_path;
                insert into workspace_content_stats (
                    root_path, ready_count, failed_count
                ) values (
                    new.root_path,
                    case when new.status = 'ready' then 1 else 0 end,
                    case when new.status = 'failed' then 1 else 0 end
                )
                on conflict(root_path) do update set
                    ready_count = ready_count + excluded.ready_count,
                    failed_count = failed_count + excluded.failed_count;
            end;",
        )
        .map_err(|error| error.to_string())?;
    if content_stats_need_backfill(connection)? {
        backfill_missing_content_stats(connection)?;
    }
    Ok(())
}

fn content_stats_need_backfill(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "select
                not exists(select 1 from workspace_content_stats limit 1)
                and exists(select 1 from workspace_content_files limit 1)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn backfill_missing_content_stats(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_content_stats (
                root_path, ready_count, failed_count
             )
             select
                files.root_path,
                sum(case when files.status = 'ready' then 1 else 0 end),
                sum(case when files.status = 'failed' then 1 else 0 end)
             from workspace_content_files files
             group by files.root_path",
            [],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn load_materialized_content_stats(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<(i64, i64)>, String> {
    connection
        .query_row(
            "select ready_count, failed_count
             from workspace_content_stats
             where root_path = ?1",
            params![root_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{create_content_stats_schema, load_materialized_content_stats};
    use rusqlite::Connection;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "create table workspace_content_files (
                    root_path text not null,
                    path text not null,
                    status text not null,
                    primary key (root_path, path)
                );",
            )
            .unwrap();
        create_content_stats_schema(&connection).unwrap();
        connection
    }

    #[test]
    fn triggers_track_insert_update_and_delete() {
        let connection = connection();
        connection
            .execute(
                "insert into workspace_content_files values (?1, ?2, 'ready')",
                ["root", "A.ets"],
            )
            .unwrap();
        connection
            .execute(
                "insert into workspace_content_files values (?1, ?2, 'failed')",
                ["root", "B.ets"],
            )
            .unwrap();
        assert_eq!(
            load_materialized_content_stats(&connection, "root").unwrap(),
            Some((1, 1))
        );

        connection
            .execute(
                "update workspace_content_files set status = 'ready' where path = 'B.ets'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "delete from workspace_content_files where path = 'A.ets'",
                [],
            )
            .unwrap();
        assert_eq!(
            load_materialized_content_stats(&connection, "root").unwrap(),
            Some((1, 0))
        );
    }

    #[test]
    fn migration_backfills_existing_rows_once() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "create table workspace_content_files (
                    root_path text not null,
                    path text not null,
                    status text not null,
                    primary key (root_path, path)
                );
                insert into workspace_content_files values
                    ('root', 'A.ets', 'ready'),
                    ('root', 'B.ets', 'failed');",
            )
            .unwrap();

        create_content_stats_schema(&connection).unwrap();
        create_content_stats_schema(&connection).unwrap();

        assert_eq!(
            load_materialized_content_stats(&connection, "root").unwrap(),
            Some((1, 1))
        );
    }
}
