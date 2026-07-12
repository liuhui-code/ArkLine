#![allow(dead_code)]

use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::services::workspace_reference_declaration_index_service::{
    load_workspace_declarations, load_workspace_declarations_for_paths, DeclarationReference,
    DeclarationReferenceInserter,
};
use crate::services::workspace_reference_identifier_index_service::{
    index_workspace_identifier_references, load_reference_alias_targets,
    load_reference_alias_targets_for_paths, ReferenceAliasTargets,
};
use crate::services::workspace_reference_member_index_service::{
    index_workspace_member_references_with_context, WorkspaceMemberReferenceContext,
};
use crate::services::workspace_reference_query_service::{
    is_reference_source_file as is_source_file,
    normalize_reference_index_path as normalize_index_path,
};
pub use crate::services::workspace_reference_query_service::{
    query_reference_at_position, query_references_by_symbol_id,
};
use crate::services::workspace_reference_refresh_plan_service::{
    plan_reference_refresh_content, plan_reference_refresh_paths,
};

pub fn create_reference_index_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_symbol_references (
                root_path text not null,
                path text not null,
                reference_id text not null,
                symbol_id text,
                name text not null,
                kind text not null,
                container text,
                line integer not null,
                column integer not null,
                end_line integer not null,
                end_column integer not null,
                confidence text not null,
                indexed_generation integer not null,
                primary key (root_path, reference_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbol_references_symbol_lookup
             on workspace_symbol_references(root_path, symbol_id)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_symbol_references_path_lookup
             on workspace_symbol_references(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_local_symbol_references (
                root_path text not null,
                path text not null,
                reference_id text not null,
                name text not null,
                kind text not null,
                line integer not null,
                column integer not null,
                end_line integer not null,
                end_column integer not null,
                confidence text not null,
                indexed_generation integer not null,
                primary key (root_path, reference_id)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_local_symbol_references_path_lookup
             on workspace_local_symbol_references(root_path, path)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn replace_workspace_references(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    replace_workspace_references_internal(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        false,
    )
}

pub fn replace_workspace_references_for_paths(
    connection: &Connection,
    root_key: &str,
    indexed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    let plan = plan_reference_refresh_paths(indexed_paths, removed_paths);
    delete_workspace_references_for_paths(connection, root_key, &plan.affected_paths)?;
    let aliases =
        load_reference_alias_targets_for_paths(connection, root_key, &plan.affected_path_set)?;
    let declarations =
        load_workspace_declarations_for_paths(connection, root_key, &plan.affected_path_set)?;
    let content_plan = plan_reference_refresh_content(indexed_paths);
    let member_context = if content_plan.member_context_required {
        Some(WorkspaceMemberReferenceContext::load(connection, root_key)?)
    } else {
        None
    };
    index_workspace_references_for_paths(
        connection,
        root_key,
        indexed_paths,
        indexed_generation,
        false,
        &aliases,
        &declarations,
        &content_plan.contents,
        member_context.as_ref(),
    )
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceReferenceRefreshProfile {
    pub delete_duration: std::time::Duration,
    pub alias_duration: std::time::Duration,
    pub declaration_duration: std::time::Duration,
    pub content_duration: std::time::Duration,
    pub member_context_duration: std::time::Duration,
    pub index_duration: std::time::Duration,
    pub affected_path_count: usize,
    pub content_count: usize,
    pub skipped_content_count: usize,
    pub member_context_loaded: bool,
}

#[cfg(test)]
pub fn profile_replace_workspace_references_for_paths(
    connection: &Connection,
    root_key: &str,
    indexed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceReferenceRefreshProfile, String> {
    let plan = plan_reference_refresh_paths(indexed_paths, removed_paths);

    let delete_start = std::time::Instant::now();
    delete_workspace_references_for_paths(connection, root_key, &plan.affected_paths)?;
    let delete_duration = delete_start.elapsed();

    let alias_start = std::time::Instant::now();
    let aliases =
        load_reference_alias_targets_for_paths(connection, root_key, &plan.affected_path_set)?;
    let alias_duration = alias_start.elapsed();

    let declaration_start = std::time::Instant::now();
    let declarations =
        load_workspace_declarations_for_paths(connection, root_key, &plan.affected_path_set)?;
    let declaration_duration = declaration_start.elapsed();

    let content_start = std::time::Instant::now();
    let content_plan = plan_reference_refresh_content(indexed_paths);
    let content_duration = content_start.elapsed();

    let member_start = std::time::Instant::now();
    let member_context = if content_plan.member_context_required {
        Some(WorkspaceMemberReferenceContext::load(connection, root_key)?)
    } else {
        None
    };
    let member_context_duration = member_start.elapsed();

    let index_start = std::time::Instant::now();
    index_workspace_references_for_paths(
        connection,
        root_key,
        indexed_paths,
        indexed_generation,
        false,
        &aliases,
        &declarations,
        &content_plan.contents,
        member_context.as_ref(),
    )?;
    let index_duration = index_start.elapsed();

    Ok(WorkspaceReferenceRefreshProfile {
        delete_duration,
        alias_duration,
        declaration_duration,
        content_duration,
        member_context_duration,
        index_duration,
        affected_path_count: plan.affected_paths.len(),
        content_count: content_plan.contents.len(),
        skipped_content_count: content_plan.skipped_oversized_paths.len(),
        member_context_loaded: member_context.is_some(),
    })
}

pub fn replace_workspace_references_with_local_scope(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    replace_workspace_references_internal(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        true,
    )
}

fn replace_workspace_references_internal(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    include_local_scope: bool,
) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_symbol_references where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "delete from workspace_local_symbol_references where root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    let aliases = load_reference_alias_targets(connection, root_key)?;
    let declarations = load_workspace_declarations(connection, root_key)?;
    let content_plan = plan_reference_refresh_content(file_paths);
    let member_context = if content_plan.member_context_required {
        Some(WorkspaceMemberReferenceContext::load(connection, root_key)?)
    } else {
        None
    };
    index_workspace_references_for_paths(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        include_local_scope,
        &aliases,
        &declarations,
        &content_plan.contents,
        member_context.as_ref(),
    )
}

fn index_workspace_references_for_paths(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    include_local_scope: bool,
    aliases: &ReferenceAliasTargets,
    declarations: &HashMap<String, Vec<DeclarationReference>>,
    contents: &HashMap<String, String>,
    member_context: Option<&WorkspaceMemberReferenceContext>,
) -> Result<(), String> {
    let mut declaration_inserter = DeclarationReferenceInserter::new(connection)?;
    for path in file_paths.iter().map(|path| normalize_index_path(path)) {
        if !is_source_file(&path) {
            continue;
        }
        declaration_inserter.index(root_key, &path, &declarations, indexed_generation)?;
        if aliases.is_empty() && member_context.is_none() && !include_local_scope {
            continue;
        }
        let Some(content) = contents.get(&path) else {
            continue;
        };
        if let Some(member_context) = member_context {
            index_workspace_member_references_with_context(
                connection,
                root_key,
                &path,
                &content,
                indexed_generation,
                member_context,
            )?;
        }
        index_workspace_identifier_references(
            connection,
            root_key,
            &path,
            &content,
            &aliases,
            indexed_generation,
            include_local_scope,
        )?;
    }
    Ok(())
}

fn delete_workspace_references_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
) -> Result<(), String> {
    let mut symbol_statement = connection
        .prepare("delete from workspace_symbol_references where root_path = ?1 and path = ?2")
        .map_err(|error| error.to_string())?;
    let mut local_statement = connection
        .prepare("delete from workspace_local_symbol_references where root_path = ?1 and path = ?2")
        .map_err(|error| error.to_string())?;
    for path in paths {
        symbol_statement
            .execute(params![root_key, path])
            .map_err(|error| error.to_string())?;
        local_statement
            .execute(params![root_key, path])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
