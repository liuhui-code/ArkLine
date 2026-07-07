use std::time::{Duration, Instant};

use rusqlite::{params, Connection};

use crate::models::workspace::ArkTsFileStub;
use crate::services::workspace_dependency_graph_service::{
    rebuild_dependency_graph, update_dependency_graph_for_paths,
};
use crate::services::workspace_index_parse_pool_service::{
    WorkspaceIndexParseJob, WorkspaceIndexParsePool,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_performance_config_service::{
    resolve_performance_config, PerformanceUserSettings,
};
use crate::services::workspace_reference_index_service::{
    replace_workspace_references, replace_workspace_references_for_paths,
};
use crate::services::workspace_stub_index_writer_service::insert_parsed_stub_rows;
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
    delete_all_stub_rows(connection, root_key)?;
    insert_stub_rows_for_files(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        WorkspaceIndexTaskPriority::FullRefresh,
    )?;
    rebuild_dependency_graph(connection, root_key, file_paths)?;
    resolve_workspace_symbols(connection, root_key, indexed_generation)?;
    replace_workspace_references(connection, root_key, file_paths, indexed_generation)?;
    Ok(())
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
    file_paths: &[String],
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
        file_paths,
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
    file_paths: &[String],
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Result<(), String> {
    let plan = plan_workspace_stub_refresh(changed_paths, removed_paths);

    delete_stub_rows_for_paths(connection, root_key, &plan.affected_paths)?;
    insert_stub_rows_for_files(
        connection,
        root_key,
        &plan.indexed_paths,
        indexed_generation,
        priority,
    )?;
    update_dependency_graph_for_paths(
        connection,
        root_key,
        file_paths,
        &plan.indexed_paths,
        &plan.removed_paths,
    )?;
    resolve_workspace_symbols_for_paths(
        connection,
        root_key,
        &plan.indexed_paths,
        &plan.removed_paths,
        indexed_generation,
    )?;
    replace_workspace_references_for_paths(
        connection,
        root_key,
        &plan.indexed_paths,
        &plan.removed_paths,
        indexed_generation,
    )?;
    Ok(())
}

fn insert_stub_rows_for_files(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Result<(), String> {
    insert_stub_rows_for_files_profiled(
        connection,
        root_key,
        file_paths,
        indexed_generation,
        priority,
        None,
    )
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

fn parse_stub_files(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<ArkTsFileStub> {
    let jobs = parse_jobs_for_paths(root_key, file_paths, indexed_generation, priority);
    let performance_config = resolve_performance_config(&PerformanceUserSettings::default());
    let pool = WorkspaceIndexParsePool::arkts_stub_pool_from_config(&performance_config);
    let mut stubs = pool
        .parse_batch(jobs)
        .into_iter()
        .filter_map(|result| result.parsed.map(|parsed| parsed.stub))
        .collect::<Vec<_>>();
    stubs.sort_by(|left, right| left.path.cmp(&right.path));
    stubs
}

fn parse_jobs_for_paths(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<WorkspaceIndexParseJob> {
    file_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .filter(|path| is_source_file(path))
        .map(|path| WorkspaceIndexParseJob {
            root_path: root_key.to_string(),
            path,
            priority,
            generation: indexed_generation,
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn stub_parse_jobs_for_paths_for_test(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<WorkspaceIndexParseJob> {
    parse_jobs_for_paths(root_key, file_paths, indexed_generation, priority)
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

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

const STUB_TABLES: &[&str] = &[
    "workspace_stub_files",
    "workspace_stub_declarations",
    "workspace_stub_imports",
    "workspace_stub_exports",
    "workspace_stub_parse_errors",
];
