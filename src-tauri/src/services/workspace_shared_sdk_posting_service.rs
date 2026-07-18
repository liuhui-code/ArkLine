use std::collections::BTreeSet;

use rusqlite::{params, Connection, Transaction};

pub fn insert_shared_sdk_symbol_postings(
    transaction: &Transaction<'_>,
    artifact_key: &str,
    symbol_id: &str,
    name: &str,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "insert or ignore into shared_sdk_symbol_trigrams (artifact_key, trigram, symbol_id)
             values (?1, ?2, ?3)",
        )
        .map_err(|error| error.to_string())?;
    for trigram in shared_sdk_symbol_trigrams(name) {
        statement
            .execute(params![artifact_key, trigram, symbol_id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn backfill_shared_sdk_symbol_postings(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "select symbol.artifact_key, symbol.symbol_id, symbol.name
             from shared_sdk_symbols symbol
             where length(symbol.normalized_name) >= 3
               and not exists (
                   select 1 from shared_sdk_symbol_trigrams posting
                   where posting.artifact_key = symbol.artifact_key
                     and posting.symbol_id = symbol.symbol_id
               )",
        )
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
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    for (artifact_key, symbol_id, name) in rows {
        insert_shared_sdk_symbol_postings(&transaction, &artifact_key, &symbol_id, &name)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn shared_sdk_symbol_trigrams(value: &str) -> Vec<String> {
    let characters = value.to_lowercase().chars().collect::<Vec<_>>();
    if characters.len() < 3 {
        return Vec::new();
    }
    characters
        .windows(3)
        .map(|window| window.iter().collect::<String>())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
