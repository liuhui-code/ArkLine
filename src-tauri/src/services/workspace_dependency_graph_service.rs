#![allow(dead_code)]

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::services::workspace_dependency_graph_cleanup_service::{
    clear_dependency_graph, clear_dependency_graph_for_path,
};
use crate::services::workspace_dependency_graph_model_service::ImportRow;
pub use crate::services::workspace_dependency_graph_model_service::{
    DependencyExpansion, DependencyGraphStatus,
};
use crate::services::workspace_dependency_graph_path_plan_service::plan_dependency_graph_paths;
use crate::services::workspace_dependency_graph_refresh_plan_service::{
    load_dependency_fact_paths, plan_dependency_refresh_paths,
};
use crate::services::workspace_dependency_graph_resolver_service::{
    is_relative_module, resolve_relative_import,
};

pub fn create_dependency_graph_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_dependency_edges (
                root_path text not null,
                from_path text not null,
                to_path text not null,
                source_module text not null,
                kind text not null,
                line integer not null,
                column integer not null,
                primary key (root_path, from_path, to_path, source_module, kind)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_dependency_reverse (
                root_path text not null,
                to_path text not null,
                from_path text not null,
                primary key (root_path, to_path, from_path)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_unresolved_imports (
                root_path text not null,
                from_path text not null,
                source_module text not null,
                line integer not null,
                column integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create table if not exists workspace_dependency_graph_metadata (
                root_path text primary key,
                status text not null,
                reason text,
                updated_at integer not null
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn rebuild_dependency_graph(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
) -> Result<(), String> {
    clear_dependency_graph(connection, root_key)?;
    index_dependency_graph_rows(
        connection,
        root_key,
        file_paths,
        &load_import_rows(connection, root_key)?,
        &load_re_export_rows(connection, root_key)?,
    )?;
    record_dependency_graph_status(connection, root_key, "ready", None)?;
    Ok(())
}

pub fn update_dependency_graph_for_paths(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_paths: &[String],
    removed_paths: &[String],
) -> Result<(), String> {
    let path_plan = plan_dependency_graph_paths(indexed_paths, removed_paths);
    let import_rows = load_import_rows(connection, root_key)?
        .into_iter()
        .filter(|row| path_plan.affected_path_set.contains(&row.from_path))
        .collect::<Vec<_>>();
    let export_rows = load_re_export_rows(connection, root_key)?
        .into_iter()
        .filter(|row| path_plan.affected_path_set.contains(&row.from_path))
        .collect::<Vec<_>>();
    let existing_paths =
        load_dependency_fact_paths(connection, root_key, &path_plan.affected_path_set)?;
    let refresh_paths = plan_dependency_refresh_paths(
        &path_plan.affected_paths,
        &import_rows,
        &export_rows,
        &existing_paths,
        &path_plan.removed_path_set,
    );
    for path in &refresh_paths {
        clear_dependency_graph_for_path(connection, root_key, path)?;
    }
    index_dependency_graph_rows(connection, root_key, file_paths, &import_rows, &export_rows)?;
    record_dependency_graph_status(connection, root_key, "ready", None)?;
    Ok(())
}

fn index_dependency_graph_rows(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    import_rows: &[ImportRow],
    export_rows: &[ImportRow],
) -> Result<(), String> {
    let file_set = file_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    for import in import_rows {
        if !is_relative_module(&import.source_module) {
            continue;
        }
        if let Some(to_path) =
            resolve_relative_import(&import.from_path, &import.source_module, &file_set)
        {
            insert_dependency_edge(connection, root_key, &import, &to_path, "import")?;
        } else {
            insert_unresolved_import(connection, root_key, &import)?;
        }
    }
    for export in export_rows {
        if let Some(to_path) =
            resolve_relative_import(&export.from_path, &export.source_module, &file_set)
        {
            insert_dependency_edge(connection, root_key, &export, &to_path, "export")?;
        } else {
            insert_unresolved_import(connection, root_key, &export)?;
        }
    }
    Ok(())
}

pub fn mark_dependency_graph_stale(root_path: &str, reason: &str) -> Result<(), String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Ok(());
    }
    let connection = Connection::open(cache_path).map_err(|error| error.to_string())?;
    let root_key = normalize_index_path(root_path);
    record_dependency_graph_status(&connection, &root_key, "stale", Some(reason))
}

pub fn load_dependency_graph_status(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<DependencyGraphStatus>, String> {
    connection
        .query_row(
            "select status, reason from workspace_dependency_graph_metadata where root_path = ?1",
            params![root_key],
            |row| {
                Ok(DependencyGraphStatus {
                    status: row.get(0)?,
                    reason: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn has_graph_affecting_config_change(paths: &[String]) -> bool {
    paths
        .iter()
        .any(|path| is_graph_affecting_config_path(path))
}

pub fn is_graph_affecting_config_path(path: &str) -> bool {
    matches!(
        Path::new(&path.replace('\\', "/"))
            .file_name()
            .and_then(|name| name.to_str()),
        Some("oh-package.json5")
            | Some("build-profile.json5")
            | Some("hvigorfile.ts")
            | Some("tsconfig.json")
            | Some("module.json5")
    )
}

pub fn query_reverse_dependencies(
    connection: &Connection,
    root_key: &str,
    to_path: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select from_path
             from workspace_dependency_reverse
             where root_path = ?1 and to_path = ?2
             order by from_path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, normalize_index_path(to_path)], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn collect_transitive_reverse_dependencies(
    connection: &Connection,
    root_key: &str,
    changed_paths: &[String],
    limit: usize,
) -> Result<Vec<String>, String> {
    let mut seen = changed_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    let mut queue = seen.iter().cloned().collect::<VecDeque<_>>();
    let mut affected = Vec::new();
    while let Some(path) = queue.pop_front() {
        for importer in query_reverse_dependencies(connection, root_key, &path)? {
            if seen.insert(importer.clone()) {
                affected.push(importer.clone());
                if affected.len() >= limit {
                    return Ok(affected);
                }
                queue.push_back(importer);
            }
        }
    }
    Ok(affected)
}

pub fn expand_changed_paths(
    root_path: &str,
    changed_paths: &[String],
    current_paths: &HashSet<String>,
    limit: usize,
) -> Result<DependencyExpansion, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    if !cache_path.exists() {
        return Ok(DependencyExpansion::Expanded(
            changed_paths
                .iter()
                .map(|path| normalize_index_path(path))
                .filter(|path| current_paths.contains(path))
                .collect(),
        ));
    }
    let connection = Connection::open(cache_path).map_err(|error| error.to_string())?;
    let root_key = normalize_index_path(root_path);
    let mut expanded = changed_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<HashSet<_>>();
    let dependents = collect_transitive_reverse_dependencies(
        &connection,
        &root_key,
        changed_paths,
        limit.saturating_add(1),
    )?;
    if dependents.len() > limit {
        return Ok(DependencyExpansion::LimitExceeded);
    }
    expanded.extend(dependents);
    let mut paths = expanded
        .into_iter()
        .filter(|path| current_paths.contains(path))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(DependencyExpansion::Expanded(paths))
}

fn record_dependency_graph_status(
    connection: &Connection,
    root_key: &str,
    status: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_dependency_graph_metadata (
                root_path, status, reason, updated_at
             ) values (?1, ?2, ?3, strftime('%s','now') * 1000)
             on conflict(root_path) do update set
                status = excluded.status,
                reason = excluded.reason,
                updated_at = excluded.updated_at",
            params![root_key, status, reason],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_import_rows(connection: &Connection, root_key: &str) -> Result<Vec<ImportRow>, String> {
    let mut statement = connection
        .prepare(
            "select path, source_module, line, column
             from workspace_stub_imports
             where root_path = ?1
             order by path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let line: i64 = row.get(2)?;
            let column: i64 = row.get(3)?;
            Ok(ImportRow {
                from_path: row.get(0)?,
                source_module: row.get(1)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_re_export_rows(connection: &Connection, root_key: &str) -> Result<Vec<ImportRow>, String> {
    let mut statement = connection
        .prepare(
            "select path, source_module, line, column
             from workspace_stub_exports
             where root_path = ?1 and source_module is not null
             order by path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            let line: i64 = row.get(2)?;
            let column: i64 = row.get(3)?;
            Ok(ImportRow {
                from_path: row.get(0)?,
                source_module: row.get(1)?,
                line: usize::try_from(line).unwrap_or_default(),
                column: usize::try_from(column).unwrap_or_default(),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn insert_dependency_edge(
    connection: &Connection,
    root_key: &str,
    import: &ImportRow,
    to_path: &str,
    kind: &str,
) -> Result<(), String> {
    connection
        .execute(
            "insert or ignore into workspace_dependency_edges (
                root_path, from_path, to_path, source_module, kind, line, column
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                root_key,
                import.from_path,
                to_path,
                import.source_module,
                kind,
                import.line as i64,
                import.column as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "insert or ignore into workspace_dependency_reverse (root_path, to_path, from_path)
             values (?1, ?2, ?3)",
            params![root_key, to_path, import.from_path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_unresolved_import(
    connection: &Connection,
    root_key: &str,
    import: &ImportRow,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_unresolved_imports (
                root_path, from_path, source_module, line, column
             ) values (?1, ?2, ?3, ?4, ?5)",
            params![
                root_key,
                import.from_path,
                import.source_module,
                import.line as i64,
                import.column as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}
