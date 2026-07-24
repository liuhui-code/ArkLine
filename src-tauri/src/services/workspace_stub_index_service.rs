use std::time::{Duration, Instant};

use rusqlite::{params, Connection};

use crate::models::workspace::ArkTsFileStub;
use crate::models::workspace_index_publication::{
    WorkspaceIndexPublicationProfile, WorkspaceIndexPublicationProfiler,
};
use crate::services::workspace_dependency_graph_service::{
    rebuild_dependency_graph, update_dependency_graph_for_paths,
};
use crate::services::workspace_index_layer_generation_service::{
    publish_layer_generation, STUB_LAYER,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_reference_index_service::{
    replace_workspace_references, replace_workspace_references_for_paths,
};
use crate::services::workspace_semantic_layer_state_service::{
    clear_semantic_layers, mark_semantic_layers_stale, publish_definition_layers,
    publish_project_model_layers, publish_syntax_layers, remove_semantic_layers,
};
use crate::services::workspace_stub_index_writer_service::insert_parsed_stub_rows;
use crate::services::workspace_stub_prepare_service::{
    parse_stub_files, prepare_changed_stub_rows, PreparedWorkspaceStubRefresh,
};
#[cfg(test)]
use crate::services::workspace_stub_refresh_plan_service::plan_workspace_stub_refresh;
use crate::services::workspace_symbol_resolution_service::{
    resolve_workspace_symbols, resolve_workspace_symbols_for_paths,
};

pub const ARKTS_STUB_PARSER_VERSION: i64 = 1;

pub fn replace_all_stub_rows(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    let stubs = parse_stub_files(
        root_key,
        file_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::FullRefresh,
    );
    replace_all_stub_rows_with_parsed(connection, root_key, file_paths, &stubs, indexed_generation)
}

pub(crate) fn replace_all_stub_rows_with_parsed(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    stubs: &[ArkTsFileStub],
    indexed_generation: u64,
) -> Result<(), String> {
    clear_semantic_layers(connection, root_key)?;
    delete_all_stub_rows(connection, root_key)?;
    insert_parsed_stub_rows(connection, root_key, stubs, indexed_generation)?;
    publish_syntax_layers(connection, root_key, file_paths, indexed_generation)?;
    rebuild_dependency_graph(connection, root_key, file_paths)?;
    publish_project_model_layers(connection, root_key, file_paths, indexed_generation)?;
    resolve_workspace_symbols(connection, root_key, indexed_generation)?;
    publish_definition_layers(connection, root_key, file_paths, indexed_generation)?;
    replace_workspace_references(connection, root_key, file_paths, indexed_generation)?;
    publish_layer_generation(connection, root_key, STUB_LAYER, indexed_generation)
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStubIndexProfile {
    pub delete_duration: Duration,
    pub insert_duration: Duration,
    pub insert_parse_duration: Duration,
    pub insert_write_duration: Duration,
    pub graph_duration: Duration,
    pub resolve_duration: Duration,
    pub reference_duration: Duration,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct WorkspaceStubInsertProfile {
    parse_duration: Duration,
    write_duration: Duration,
}

#[cfg(test)]
pub fn profile_replace_all_stub_rows(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceStubIndexProfile, String> {
    let delete_start = Instant::now();
    delete_all_stub_rows(connection, root_key)?;
    let delete_duration = delete_start.elapsed();

    let insert_start = Instant::now();
    let mut insert_profile = WorkspaceStubInsertProfile::default();
    insert_stub_rows_for_files_profiled(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::FullRefresh,
        Some(&mut insert_profile),
    )?;
    let insert_duration = insert_start.elapsed();

    let graph_start = Instant::now();
    rebuild_dependency_graph(connection, root_key, file_paths)?;
    let graph_duration = graph_start.elapsed();

    let resolve_start = Instant::now();
    resolve_workspace_symbols(connection, root_key, indexed_generation)?;
    let resolve_duration = resolve_start.elapsed();

    let reference_start = Instant::now();
    replace_workspace_references(connection, root_key, file_paths, indexed_generation)?;
    let reference_duration = reference_start.elapsed();

    Ok(WorkspaceStubIndexProfile {
        delete_duration,
        insert_duration,
        insert_parse_duration: insert_profile.parse_duration,
        insert_write_duration: insert_profile.write_duration,
        graph_duration,
        resolve_duration,
        reference_duration,
    })
}

#[cfg(test)]
pub fn profile_replace_changed_stub_rows(
    connection: &Connection,
    root_key: &str,
    _file_paths: &[String],
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<WorkspaceStubIndexProfile, String> {
    let plan = plan_workspace_stub_refresh(changed_paths, removed_paths);

    let delete_start = Instant::now();
    delete_stub_rows_for_paths(connection, root_key, &plan.affected_paths)?;
    let delete_duration = delete_start.elapsed();

    let insert_start = Instant::now();
    let mut insert_profile = WorkspaceStubInsertProfile::default();
    insert_stub_rows_for_files_profiled(
        connection,
        root_key,
        &plan.indexed_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::ChangedFiles,
        Some(&mut insert_profile),
    )?;
    let insert_duration = insert_start.elapsed();

    let graph_start = Instant::now();
    update_dependency_graph_for_paths(
        connection,
        root_key,
        &plan.indexed_paths,
        &plan.removed_paths,
    )?;
    let graph_duration = graph_start.elapsed();

    let resolve_start = Instant::now();
    resolve_workspace_symbols_for_paths(
        connection,
        root_key,
        &plan.indexed_paths,
        &plan.removed_paths,
        indexed_generation,
    )?;
    let resolve_duration = resolve_start.elapsed();

    let reference_start = Instant::now();
    replace_workspace_references_for_paths(
        connection,
        root_key,
        &plan.indexed_paths,
        &plan.removed_paths,
        indexed_generation,
    )?;
    let reference_duration = reference_start.elapsed();

    Ok(WorkspaceStubIndexProfile {
        delete_duration,
        insert_duration,
        insert_parse_duration: insert_profile.parse_duration,
        insert_write_duration: insert_profile.write_duration,
        graph_duration,
        resolve_duration,
        reference_duration,
    })
}

pub fn replace_changed_stub_rows(
    connection: &Connection,
    root_key: &str,
    _file_paths: &[String],
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Result<(), String> {
    let prepared = prepare_changed_stub_rows(
        root_key,
        changed_paths,
        removed_paths,
        indexed_generation,
        priority,
    );
    replace_changed_stub_rows_with_parsed(connection, root_key, &prepared, indexed_generation)
}

pub(crate) fn replace_changed_stub_rows_with_parsed(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceStubRefresh,
    indexed_generation: u64,
) -> Result<(), String> {
    replace_changed_stub_rows_with_parsed_profiled(
        connection,
        root_key,
        prepared,
        indexed_generation,
    )
    .map(|_| ())
}

pub(crate) fn replace_changed_stub_rows_with_parsed_profiled(
    connection: &Connection,
    root_key: &str,
    prepared: &PreparedWorkspaceStubRefresh,
    indexed_generation: u64,
) -> Result<WorkspaceIndexPublicationProfile, String> {
    let plan = &prepared.plan;
    let mut profiler = WorkspaceIndexPublicationProfiler::start();
    profiler.measure("stubSemanticState", || {
        mark_semantic_layers_stale(
            connection,
            root_key,
            &plan.affected_paths,
            indexed_generation,
        )?;
        remove_semantic_layers(connection, root_key, &plan.removed_paths)
    })?;
    profiler.measure("stubDelete", || {
        delete_stub_rows_for_paths(connection, root_key, &plan.affected_paths)
    })?;
    profiler.measure("stubInsert", || {
        insert_parsed_stub_rows(connection, root_key, &prepared.stubs, indexed_generation)
            .map(|_| ())
    })?;
    profiler.measure("stubSyntax", || {
        publish_syntax_layers(
            connection,
            root_key,
            &plan.indexed_paths,
            indexed_generation,
        )
    })?;
    profiler.measure("stubDependency", || {
        update_dependency_graph_for_paths(
            connection,
            root_key,
            &plan.indexed_paths,
            &plan.removed_paths,
        )
    })?;
    profiler.measure("stubProjectModel", || {
        publish_project_model_layers(
            connection,
            root_key,
            &plan.indexed_paths,
            indexed_generation,
        )
    })?;
    profiler.measure("stubResolve", || {
        resolve_workspace_symbols_for_paths(
            connection,
            root_key,
            &plan.indexed_paths,
            &plan.removed_paths,
            indexed_generation,
        )
    })?;
    profiler.measure("stubDefinition", || {
        publish_definition_layers(
            connection,
            root_key,
            &plan.indexed_paths,
            indexed_generation,
        )
    })?;
    profiler.measure("stubReference", || {
        replace_workspace_references_for_paths(
            connection,
            root_key,
            &plan.indexed_paths,
            &plan.removed_paths,
            indexed_generation,
        )
    })?;
    profiler.measure("stubGeneration", || {
        publish_layer_generation(connection, root_key, STUB_LAYER, indexed_generation)
    })?;
    Ok(profiler.finish())
}

fn insert_stub_rows_for_files_profiled(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
    mut profile: Option<&mut WorkspaceStubInsertProfile>,
) -> Result<(), String> {
    let parse_start = Instant::now();
    let stubs = parse_stub_files(root_key, file_paths, indexed_generation, priority);
    if let Some(profile) = profile.as_mut() {
        profile.parse_duration += parse_start.elapsed();
    }
    let write_profile = insert_parsed_stub_rows(connection, root_key, &stubs, indexed_generation)?;
    if let Some(profile) = profile.as_mut() {
        profile.write_duration += write_profile.write_duration;
    }
    Ok(())
}

fn delete_all_stub_rows(connection: &Connection, root_key: &str) -> Result<(), String> {
    for table in STUB_TABLES {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1"),
                params![root_key],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn delete_stub_rows_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
) -> Result<(), String> {
    for table in STUB_TABLES {
        let sql = format!("delete from {table} where root_path = ?1 and path = ?2");
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        for path in paths {
            statement
                .execute(params![root_key, path])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

const STUB_TABLES: &[&str] = &[
    "workspace_symbol_trigrams",
    "workspace_symbol_postings",
    "workspace_stub_files",
    "workspace_stub_declarations",
    "workspace_stub_imports",
    "workspace_stub_exports",
    "workspace_stub_parse_errors",
];
