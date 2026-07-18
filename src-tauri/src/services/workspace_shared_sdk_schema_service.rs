use rusqlite::{params, Connection};

use crate::services::workspace_shared_sdk_posting_service::backfill_shared_sdk_symbol_postings;

pub fn ensure_shared_sdk_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists shared_sdk_artifacts (
                artifact_key text primary key,
                sdk_path text not null,
                sdk_version text not null,
                manifest_fingerprint text not null,
                parser_version text not null,
                schema_version integer not null,
                status text not null,
                symbol_count integer not null default 0,
                updated_at integer not null
             );
             create table if not exists shared_sdk_symbols (
                artifact_key text not null,
                symbol_id text not null,
                kind text not null,
                name text not null,
                normalized_name text not null,
                acronym text not null,
                path text not null,
                line integer not null,
                column integer not null,
                container text,
                signature text,
                primary key (artifact_key, symbol_id)
             );
             create index if not exists shared_sdk_symbols_name_lookup
                on shared_sdk_symbols(artifact_key, normalized_name, kind);
             create index if not exists shared_sdk_symbols_container_lookup
                on shared_sdk_symbols(artifact_key, container, normalized_name);
             create table if not exists shared_sdk_symbol_trigrams (
                artifact_key text not null,
                trigram text not null,
                symbol_id text not null,
                primary key (artifact_key, trigram, symbol_id)
             );
             create index if not exists shared_sdk_symbol_trigrams_lookup
                on shared_sdk_symbol_trigrams(artifact_key, trigram, symbol_id);",
        )
        .map_err(|error| error.to_string())?;
    ensure_acronym_column(connection)?;
    ensure_artifact_symbol_count_column(connection)?;
    backfill_shared_sdk_symbol_postings(connection)?;
    connection
        .execute(
            "create index if not exists shared_sdk_symbols_acronym_lookup
             on shared_sdk_symbols(artifact_key, acronym, kind)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn shared_sdk_symbol_acronym(value: &str) -> String {
    value
        .char_indices()
        .filter_map(|(index, character)| {
            let previous = value[..index].chars().next_back();
            (index == 0
                || character.is_ascii_uppercase()
                    && previous.is_some_and(|item| item.is_ascii_lowercase()))
            .then(|| character.to_ascii_lowercase())
        })
        .collect()
}

fn ensure_acronym_column(connection: &Connection) -> Result<(), String> {
    let columns = table_columns(connection, "shared_sdk_symbols")?;
    if !columns.iter().any(|column| column == "acronym") {
        connection
            .execute(
                "alter table shared_sdk_symbols add column acronym text not null default ''",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let mut statement = connection
        .prepare("select artifact_key, symbol_id, name from shared_sdk_symbols where acronym = ''")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    for (artifact_key, symbol_id, name) in rows {
        connection
            .execute(
                "update shared_sdk_symbols set acronym = ?3
                 where artifact_key = ?1 and symbol_id = ?2",
                params![artifact_key, symbol_id, shared_sdk_symbol_acronym(&name)],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ensure_artifact_symbol_count_column(connection: &Connection) -> Result<(), String> {
    let columns = table_columns(connection, "shared_sdk_artifacts")?;
    if !columns.iter().any(|column| column == "symbol_count") {
        connection
            .execute(
                "alter table shared_sdk_artifacts add column symbol_count integer not null default 0",
                [],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "update shared_sdk_artifacts
                 set symbol_count = (select count(*) from shared_sdk_symbols
                                     where artifact_key = shared_sdk_artifacts.artifact_key)",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    connection
        .prepare(&format!("pragma table_info({table})"))
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| error.to_string())
}
