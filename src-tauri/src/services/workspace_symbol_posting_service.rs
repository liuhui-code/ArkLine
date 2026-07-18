use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension, Statement};

use crate::models::workspace::WorkspaceIndexedSymbol;
use crate::services::workspace_search_ranking_service::camel_case_acronym;

const SYMBOL_POSTING_CANDIDATE_LIMIT: usize = 512;

pub(crate) fn create_symbol_posting_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists workspace_symbol_postings (
                root_path text not null,
                origin text not null,
                entity_id text not null,
                path text not null,
                source text not null,
                normalized_name text not null,
                initial text not null,
                acronym text,
                primary key (root_path, origin, entity_id)
            );
            create index if not exists workspace_symbol_postings_name_lookup
                on workspace_symbol_postings(root_path, origin, source, normalized_name);
            create index if not exists workspace_symbol_postings_acronym_lookup
                on workspace_symbol_postings(root_path, origin, source, acronym);
            create index if not exists workspace_symbol_postings_initial_lookup
                on workspace_symbol_postings(root_path, origin, source, initial, normalized_name);
            create index if not exists workspace_symbol_postings_path_lookup
                on workspace_symbol_postings(root_path, path);
            create table if not exists workspace_symbol_trigrams (
                root_path text not null,
                origin text not null,
                entity_id text not null,
                path text not null,
                trigram text not null,
                primary key (root_path, origin, entity_id, trigram)
            );
            create index if not exists workspace_symbol_trigrams_lookup
                on workspace_symbol_trigrams(root_path, origin, trigram, entity_id);
            create index if not exists workspace_symbol_trigrams_path_lookup
                on workspace_symbol_trigrams(root_path, path);",
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn symbol_trigram_insert_statement(
    connection: &Connection,
) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert or ignore into workspace_symbol_trigrams (
                root_path, origin, entity_id, path, trigram
             ) values (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn symbol_posting_insert_statement(
    connection: &Connection,
) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert or replace into workspace_symbol_postings (
                root_path, origin, entity_id, path, source, normalized_name, initial, acronym
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn insert_symbol_posting_with_statement(
    statement: &mut Statement<'_>,
    trigram_statement: &mut Statement<'_>,
    root_key: &str,
    origin: &str,
    entity_id: &str,
    path: &str,
    source: &str,
    name: &str,
) -> Result<(), String> {
    let normalized_name = name.to_lowercase();
    let initial = normalized_name
        .chars()
        .next()
        .map(|character| character.to_string())
        .unwrap_or_default();
    statement
        .execute(params![
            root_key,
            origin,
            entity_id,
            path,
            source,
            normalized_name,
            initial,
            camel_case_acronym(name),
        ])
        .map_err(|error| error.to_string())?;
    for trigram in symbol_trigrams(&normalized_name) {
        trigram_statement
            .execute(params![root_key, origin, entity_id, path, trigram])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn query_posted_symbols(
    connection: &Connection,
    root_key: &str,
    query: &str,
    source: Option<&str>,
    requested_limit: usize,
) -> Result<Option<Vec<WorkspaceIndexedSymbol>>, String> {
    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let candidate_limit = requested_limit
        .max(32)
        .saturating_mul(8)
        .min(SYMBOL_POSTING_CANDIDATE_LIMIT);

    if has_postings(connection, root_key, "stub")? {
        return query_stub_postings(
            connection,
            root_key,
            &normalized_query,
            source,
            candidate_limit,
        )
        .map(Some);
    }
    if has_postings(connection, root_key, "entity")? {
        return query_entity_postings(
            connection,
            root_key,
            &normalized_query,
            source,
            candidate_limit,
        )
        .map(Some);
    }
    Ok(None)
}

fn has_postings(connection: &Connection, root_key: &str, origin: &str) -> Result<bool, String> {
    let sql = match origin {
        "stub" => {
            "select 1 from workspace_symbol_postings posting
             join workspace_stub_declarations declaration
               on declaration.root_path = posting.root_path
              and declaration.entity_id = posting.entity_id
             where posting.root_path = ?1 and posting.origin = 'stub' limit 1"
        }
        _ => {
            "select 1 from workspace_symbol_postings posting
             join workspace_symbol_entities entity
               on entity.root_path = posting.root_path and entity.entity_id = posting.entity_id
             where posting.root_path = ?1 and posting.origin = 'entity' limit 1"
        }
    };
    connection
        .query_row(sql, params![root_key], |_| Ok(true))
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| error.to_string())
}

fn query_stub_postings(
    connection: &Connection,
    root_key: &str,
    query: &str,
    source: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select declaration.kind, declaration.name, declaration.path, declaration.line,
                    declaration.column, declaration.container, declaration.signature,
                    declaration.visibility
             from workspace_symbol_postings posting
             join workspace_stub_declarations declaration
               on declaration.root_path = posting.root_path
              and declaration.entity_id = posting.entity_id
             where posting.root_path = ?1 and posting.origin = 'stub'
               and (?2 is null or posting.source = ?2)
               and (posting.normalized_name = ?3
                    or posting.normalized_name >= ?3 and posting.normalized_name < ?4
                    or posting.acronym = ?3
                    or posting.acronym >= ?3 and posting.acronym < ?4
                    or posting.initial = ?5
                    or exists (
                        select 1 from workspace_symbol_trigrams trigram
                        where trigram.root_path = posting.root_path
                          and trigram.origin = posting.origin
                          and trigram.entity_id = posting.entity_id
                          and trigram.trigram = ?6))
             order by case
                when posting.normalized_name = ?3 then 0
                when posting.normalized_name >= ?3 and posting.normalized_name < ?4 then 1
                when posting.acronym = ?3 then 2
                when posting.acronym >= ?3 and posting.acronym < ?4 then 3
                when exists (
                    select 1 from workspace_symbol_trigrams trigram
                    where trigram.root_path = posting.root_path
                      and trigram.origin = posting.origin
                      and trigram.entity_id = posting.entity_id
                      and trigram.trigram = ?6) then 4
                else 5 end,
                length(posting.normalized_name), posting.normalized_name
             limit ?7",
        )
        .map_err(|error| error.to_string())?;
    let prefix_end = format!("{query}\u{10ffff}");
    let initial = query
        .chars()
        .next()
        .map(|character| character.to_string())
        .unwrap_or_default();
    let trigram = first_trigram(query);
    let rows = statement
        .query_map(
            params![
                root_key,
                source,
                query,
                prefix_end,
                initial,
                trigram,
                limit as i64
            ],
            row_to_stub_symbol,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn query_entity_postings(
    connection: &Connection,
    root_key: &str,
    query: &str,
    source: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkspaceIndexedSymbol>, String> {
    let mut statement = connection
        .prepare(
            "select entity.source, entity.kind, entity.name, entity.path, entity.line,
                    entity.column, entity.container, entity.signature, entity.visibility
             from workspace_symbol_postings posting
             join workspace_symbol_entities entity
               on entity.root_path = posting.root_path and entity.entity_id = posting.entity_id
             where posting.root_path = ?1 and posting.origin = 'entity'
               and (?2 is null or posting.source = ?2)
               and (posting.normalized_name = ?3
                    or posting.normalized_name >= ?3 and posting.normalized_name < ?4
                    or posting.acronym = ?3
                    or posting.acronym >= ?3 and posting.acronym < ?4
                    or posting.initial = ?5
                    or exists (
                        select 1 from workspace_symbol_trigrams trigram
                        where trigram.root_path = posting.root_path
                          and trigram.origin = posting.origin
                          and trigram.entity_id = posting.entity_id
                          and trigram.trigram = ?6))
             order by case
                when posting.normalized_name = ?3 then 0
                when posting.normalized_name >= ?3 and posting.normalized_name < ?4 then 1
                when posting.acronym = ?3 then 2
                when posting.acronym >= ?3 and posting.acronym < ?4 then 3
                when exists (
                    select 1 from workspace_symbol_trigrams trigram
                    where trigram.root_path = posting.root_path
                      and trigram.origin = posting.origin
                      and trigram.entity_id = posting.entity_id
                      and trigram.trigram = ?6) then 4
                else 5 end,
                length(posting.normalized_name), posting.normalized_name
             limit ?7",
        )
        .map_err(|error| error.to_string())?;
    let prefix_end = format!("{query}\u{10ffff}");
    let initial = query
        .chars()
        .next()
        .map(|character| character.to_string())
        .unwrap_or_default();
    let trigram = first_trigram(query);
    let rows = statement
        .query_map(
            params![
                root_key,
                source,
                query,
                prefix_end,
                initial,
                trigram,
                limit as i64
            ],
            row_to_entity_symbol,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn symbol_trigrams(value: &str) -> BTreeSet<String> {
    let characters = value.chars().collect::<Vec<_>>();
    characters
        .windows(3)
        .map(|window| window.iter().collect::<String>())
        .collect()
}

fn first_trigram(value: &str) -> String {
    value.chars().take(3).collect()
}

fn row_to_stub_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceIndexedSymbol> {
    let kind: String = row.get(0)?;
    Ok(WorkspaceIndexedSymbol {
        source: source_for_kind(&kind).to_string(),
        kind,
        name: row.get(1)?,
        path: row.get(2)?,
        line: row.get::<_, i64>(3)?.max(0) as usize,
        column: row.get::<_, i64>(4)?.max(0) as usize,
        container: row.get(5)?,
        signature: row.get(6)?,
        visibility: row.get(7)?,
    })
}

fn row_to_entity_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceIndexedSymbol> {
    Ok(WorkspaceIndexedSymbol {
        source: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        line: row.get::<_, i64>(4)?.max(0) as usize,
        column: row.get::<_, i64>(5)?.max(0) as usize,
        container: row.get(6)?,
        signature: row.get(7)?,
        visibility: row.get(8)?,
    })
}

pub(crate) fn source_for_kind(kind: &str) -> &'static str {
    if matches!(kind, "struct" | "class" | "interface" | "enum" | "type") {
        "class"
    } else {
        "symbol"
    }
}
