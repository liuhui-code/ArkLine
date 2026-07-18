use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::services::workspace_dependency_graph_service::create_dependency_graph_tables;
use crate::services::workspace_discovery_schema_service::create_discovery_tables;
use crate::services::workspace_file_identity_service::create_workspace_file_identity_table;
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_event_service::create_index_event_tables;
use crate::services::workspace_index_layer_generation_service::create_layer_generation_table;
pub use crate::services::workspace_index_schema_version_service::load_workspace_index_schema_versions;
use crate::services::workspace_index_schema_version_service::{
    create_workspace_index_schema_version_table, record_workspace_index_schema_versions,
};
use crate::services::workspace_reference_index_service::create_reference_index_tables;
use crate::services::workspace_sdk_schema_service::create_sdk_tables;
use crate::services::workspace_semantic_layer_state_service::create_semantic_layer_tables;
use crate::services::workspace_symbol_posting_service::create_symbol_posting_tables;
use crate::services::workspace_symbol_resolution_schema_service::create_symbol_resolution_tables;

pub fn migrate_workspace_index_schema(root_path: &str) -> Result<(), String> {
    if !Path::new(root_path).is_dir() {
        return Ok(());
    }

    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)
    })
}

pub fn ensure_workspace_index_schema(connection: &Connection) -> Result<(), String> {
    create_workspace_index_schema_version_table(connection)?;
    create_catalog_tables(connection)?;
    create_workspace_file_identity_table(connection)?;
    create_layer_generation_table(connection)?;
    create_entity_tables(connection)?;
    create_stub_tables(connection)?;
    create_symbol_posting_tables(connection)?;
    create_content_tables(connection)?;
    create_fingerprint_tables(connection)?;
    create_sdk_tables(connection)?;
    create_task_journal_tables(connection)?;
    create_index_event_tables(connection)?;
    create_resume_tables(connection)?;
    create_discovery_tables(connection)?;
    create_dependency_graph_tables(connection)?;
    create_symbol_resolution_tables(connection)?;
    create_reference_index_tables(connection)?;
    create_semantic_layer_tables(connection)?;
    record_workspace_index_schema_versions(connection)
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
        .execute_batch(
            "create table if not exists workspace_content_files (
                root_path text not null,
                path text not null,
                indexed_generation integer not null,
                line_count integer not null,
                status text not null,
                error text,
                updated_at integer not null,
                primary key (root_path, path)
            );
            create index if not exists workspace_content_files_generation
                on workspace_content_files(root_path, indexed_generation);",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_content_lines (
                root_path text not null,
                path text not null,
                file_id integer,
                line integer not null,
                text text not null,
                primary key (root_path, path, line)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_column(
        connection,
        "workspace_content_lines",
        "file_id",
        "alter table workspace_content_lines add column file_id integer",
    )?;
    connection
        .execute(
            "create index if not exists workspace_content_lines_lookup
             on workspace_content_lines(root_path, text)",
            [],
        )
        .map_err(|error| error.to_string())?;
    ensure_content_fts_table(
        connection,
        "workspace_content_fts",
        "create virtual table workspace_content_fts
         using fts5(root_path unindexed, path unindexed, file_id unindexed,
                    line unindexed, text)",
    )?;
    ensure_content_fts_table(
        connection,
        "workspace_content_trigram_fts",
        "create virtual table workspace_content_trigram_fts
         using fts5(root_path unindexed, path unindexed, file_id unindexed,
                    line unindexed, text, tokenize='trigram')",
    )?;
    Ok(())
}

fn ensure_content_fts_table(
    connection: &Connection,
    table: &str,
    create_sql: &str,
) -> Result<(), String> {
    let existing_sql = connection
        .query_row(
            "select sql from sqlite_master where type = 'table' and name = ?1",
            [table],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(existing_sql) = existing_sql {
        if existing_sql.to_lowercase().contains("file_id") {
            return Ok(());
        }
        connection
            .execute(&format!("drop table {table}"), [])
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(create_sql, [])
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
