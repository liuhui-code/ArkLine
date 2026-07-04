use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::services::workspace_dependency_graph_service::create_dependency_graph_tables;
use crate::services::workspace_index_event_service::create_index_event_tables;
use crate::services::workspace_reference_index_service::create_reference_index_tables;
use crate::services::workspace_sdk_schema_service::create_sdk_tables;
use crate::services::workspace_symbol_resolution_schema_service::create_symbol_resolution_tables;

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
];

pub fn migrate_workspace_index_schema(root_path: &str) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let connection = Connection::open(cache_path).map_err(|error| error.to_string())?;
    ensure_workspace_index_schema(&connection)
}

pub fn ensure_workspace_index_schema(connection: &Connection) -> Result<(), String> {
    create_schema_version_table(connection)?;
    create_catalog_tables(connection)?;
    create_entity_tables(connection)?;
    create_stub_tables(connection)?;
    create_content_tables(connection)?;
    create_fingerprint_tables(connection)?;
    create_sdk_tables(connection)?;
    create_task_journal_tables(connection)?;
    create_index_event_tables(connection)?;
    create_resume_tables(connection)?;
    create_dependency_graph_tables(connection)?;
    create_symbol_resolution_tables(connection)?;
    create_reference_index_tables(connection)?;
    record_domain_versions(connection)
}

#[allow(dead_code)]
pub fn load_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<HashMap<String, i64>, String> {
    create_schema_version_table(connection)?;
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

fn create_schema_version_table(connection: &Connection) -> Result<(), String> {
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

fn create_catalog_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_catalog (
                root_path text primary key,
                schema_version integer not null,
                state_json text not null,
                updated_at integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_files (
                root_path text not null,
                path text not null,
                primary key (root_path, path)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_symbols (
                root_path text not null,
                source text not null,
                symbol_id text,
                kind text not null,
                name text not null,
                path text not null,
                line integer not null,
                column integer not null,
                container text,
                primary key (root_path, source, kind, name, path, line, column)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_index_metadata (
                root_path text primary key,
                status text not null,
                indexed_at integer,
                partial_reason text,
                updated_at integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbols_lookup
             on workspace_symbols(root_path, source, name)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbols_path_lookup
             on workspace_symbols(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_content_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_content_lines (
                root_path text not null,
                path text not null,
                line integer not null,
                text text not null,
                primary key (root_path, path, line)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_content_lines_lookup
             on workspace_content_lines(root_path, text)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create virtual table if not exists workspace_content_fts
             using fts5(root_path unindexed, path unindexed, line unindexed, text)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_entity_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_symbol_entities (
                root_path text not null,
                entity_id text not null,
                qualified_name text not null,
                source text not null,
                kind text not null,
                name text not null,
                container text,
                path text not null,
                line integer not null,
                column integer not null,
                end_line integer not null,
                end_column integer not null,
                visibility text,
                signature text,
                origin text not null,
                primary key (root_path, entity_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbol_entities_lookup
             on workspace_symbol_entities(root_path, source, qualified_name)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbol_entities_path_lookup
             on workspace_symbol_entities(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_stub_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_stub_files (
                root_path text not null,
                path text not null,
                parser_version integer not null,
                indexed_generation integer not null,
                parse_status text not null,
                error_count integer not null,
                primary key (root_path, path)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_stub_declarations (
                root_path text not null,
                path text not null,
                entity_id text not null,
                kind text not null,
                name text not null,
                qualified_name text not null,
                container text,
                visibility text,
                signature text not null,
                line integer not null,
                column integer not null,
                end_line integer not null,
                end_column integer not null,
                modifiers_json text not null,
                decorators_json text not null,
                primary key (root_path, entity_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_stub_imports (
                root_path text not null,
                path text not null,
                source_module text not null,
                imported_name text,
                local_name text not null,
                is_type_only integer not null,
                line integer not null,
                column integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_stub_exports (
                root_path text not null,
                path text not null,
                exported_name text not null,
                local_name text,
                source_module text,
                is_default integer not null,
                line integer not null,
                column integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_stub_parse_errors (
                root_path text not null,
                path text not null,
                message text not null,
                line integer not null,
                column integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_stub_declarations_lookup
             on workspace_stub_declarations(root_path, qualified_name)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_stub_declarations_path_lookup
             on workspace_stub_declarations(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_fingerprint_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_file_fingerprints (
                root_path text not null,
                path text not null,
                mtime_ms integer not null,
                size integer not null,
                hash text not null,
                content_index_version integer not null,
                symbol_index_version integer not null,
                stub_parser_version integer not null default 1,
                indexed_generation integer not null,
                primary key (root_path, path)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_column(
        connection,
        "workspace_file_fingerprints",
        "stub_parser_version",
        "alter table workspace_file_fingerprints add column stub_parser_version integer not null default 1",
    )?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("pragma table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !columns.iter().any(|existing| existing == column) {
        connection
            .execute(alter_sql, [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn create_task_journal_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_task_journal (
                root_path text not null,
                task_id text not null,
                kind text not null,
                status text not null,
                reason text not null,
                generation integer not null,
                progress_current integer not null,
                progress_total integer not null,
                started_at integer,
                finished_at integer,
                last_heartbeat_at integer,
                stalled integer not null default 0,
                symbol_count integer,
                message text,
                error text,
                updated_at integer not null,
                primary key (root_path, task_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_column(
        connection,
        "workspace_index_task_journal",
        "last_heartbeat_at",
        "alter table workspace_index_task_journal add column last_heartbeat_at integer",
    )?;
    ensure_column(
        connection,
        "workspace_index_task_journal",
        "stalled",
        "alter table workspace_index_task_journal add column stalled integer not null default 0",
    )?;
    connection
        .execute(
            "create index if not exists workspace_index_task_journal_recent
             on workspace_index_task_journal(root_path, generation)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_resume_tables(connection: &Connection) -> Result<(), String> {
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

fn record_domain_versions(connection: &Connection) -> Result<(), String> {
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

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}
