use std::collections::HashMap;

use rusqlite::{params, Connection};

const SCHEMA_DOMAINS: &[(&str, i64)] = &[
    ("catalog", 1),
    ("content", 1),
    ("entity", 1),
    ("symbol", 1),
    ("stub", 1),
    ("dependency", 1),
    ("symbol_resolution", 1),
    ("reference", 1),
    ("fingerprint", 1),
    ("sdk", 1),
    ("task_journal", 1),
    ("event", 1),
    ("resume", 1),
    ("discovery", 1),
];

#[cfg(test)]
pub(crate) const WORKSPACE_INDEX_SCHEMA_DOMAIN_COUNT: usize = SCHEMA_DOMAINS.len();

pub(crate) fn create_workspace_index_schema_version_table(
    connection: &Connection,
) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_schema_versions (
                domain text primary key,
                version integer not null,
                migrated_at integer not null default (strftime('%s','now') * 1000)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn record_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<(), String> {
    create_workspace_index_schema_version_table(connection)?;
    for (domain, version) in SCHEMA_DOMAINS {
        connection
            .execute(
                "insert into workspace_index_schema_versions (domain, version, migrated_at)
                 values (?1, ?2, strftime('%s','now') * 1000)
                 on conflict(domain) do update set
                    version = excluded.version,
                    migrated_at = excluded.migrated_at",
                params![domain, version],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn load_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<HashMap<String, i64>, String> {
    create_workspace_index_schema_version_table(connection)?;
    let mut statement = connection
        .prepare(
            "select domain, version
             from workspace_index_schema_versions
             order by domain",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| error.to_string())
}
