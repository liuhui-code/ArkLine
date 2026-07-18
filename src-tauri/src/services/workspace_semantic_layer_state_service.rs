use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::workspace_semantic_layer::WorkspaceSemanticLayerReadiness;

pub(crate) const SEMANTIC_LAYERS: &[&str] = &[
    "syntax",
    "editorSyntax",
    "projectModel",
    "definitions",
    "editorDefinitions",
    "types",
    "editorTypes",
    "references",
];

pub(crate) fn create_semantic_layer_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_semantic_file_layers (
                root_path text not null,
                path text not null,
                layer text not null,
                status text not null,
                source_generation integer not null,
                dependency_generation integer not null,
                producer_version integer not null,
                result_count integer not null default 0,
                error text,
                updated_at integer not null,
                primary key (root_path, path, layer)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "create index if not exists workspace_semantic_file_layers_status
             on workspace_semantic_file_layers(root_path, layer, status)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn publish_semantic_layer(
    connection: &Connection,
    root_key: &str,
    path: &str,
    layer: &str,
    status: &str,
    generation: u64,
    result_count: i64,
    error: Option<&str>,
) -> Result<(), String> {
    publish_semantic_layer_generations(
        connection,
        root_key,
        path,
        layer,
        status,
        generation,
        generation,
        result_count,
        error,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn publish_semantic_layer_generations(
    connection: &Connection,
    root_key: &str,
    path: &str,
    layer: &str,
    status: &str,
    source_generation: u64,
    dependency_generation: u64,
    result_count: i64,
    error: Option<&str>,
) -> Result<(), String> {
    let path = normalize_path(path);
    connection
        .execute(
            "insert into workspace_semantic_file_layers (
                root_path, path, layer, status, source_generation,
                dependency_generation, producer_version, result_count, error, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, strftime('%s','now') * 1000)
             on conflict(root_path, path, layer) do update set
                status = excluded.status,
                source_generation = excluded.source_generation,
                dependency_generation = excluded.dependency_generation,
                producer_version = excluded.producer_version,
                result_count = excluded.result_count,
                error = excluded.error,
                updated_at = excluded.updated_at
             where excluded.source_generation >= workspace_semantic_file_layers.source_generation",
            params![
                root_key,
                path,
                layer,
                status,
                source_generation as i64,
                dependency_generation as i64,
                result_count,
                error,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn publish_syntax_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    generation: u64,
) -> Result<(), String> {
    for path in source_paths(paths) {
        let row = connection
            .query_row(
                "select parse_status, error_count,
                    (select count(*) from workspace_stub_declarations declaration
                     where declaration.root_path = file.root_path and declaration.path = file.path)
                 from workspace_stub_files file
                 where root_path = ?1 and path = ?2",
                params![root_key, path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((parse_status, error_count, result_count)) = row else {
            continue;
        };
        let failed = parse_status == "failed" || error_count > 0;
        let message = failed.then(|| format!("Parser reported {error_count} error(s)"));
        publish_semantic_layer(
            connection,
            root_key,
            &path,
            "syntax",
            if failed { "failed" } else { "ready" },
            generation,
            result_count,
            message.as_deref(),
        )?;
    }
    Ok(())
}

pub(crate) fn publish_project_model_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    generation: u64,
) -> Result<(), String> {
    publish_counted_layers(
        connection,
        root_key,
        paths,
        generation,
        "projectModel",
        "workspace_dependency_edges",
        "from_path",
    )
}

pub(crate) fn publish_definition_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    generation: u64,
) -> Result<(), String> {
    publish_counted_layers(
        connection,
        root_key,
        paths,
        generation,
        "definitions",
        "workspace_resolved_symbols",
        "path",
    )
}

pub(crate) fn publish_reference_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    skipped_paths: &[String],
    generation: u64,
) -> Result<(), String> {
    let skipped = skipped_paths
        .iter()
        .map(|path| normalize_path(path))
        .collect::<HashSet<_>>();
    for path in source_paths(paths) {
        let count = count_path_rows(
            connection,
            "workspace_symbol_references",
            "path",
            root_key,
            &path,
        )?;
        let is_partial = skipped.contains(&path);
        publish_semantic_layer(
            connection,
            root_key,
            &path,
            "references",
            if is_partial { "partial" } else { "ready" },
            generation,
            count,
            is_partial.then_some("Reference indexing skipped this oversized file"),
        )?;
    }
    Ok(())
}

pub(crate) fn mark_semantic_layers_stale(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    generation: u64,
) -> Result<(), String> {
    for path in paths.iter().map(|path| normalize_path(path)) {
        connection
            .execute(
                "update workspace_semantic_file_layers
                 set status = 'stale', source_generation = ?3,
                     dependency_generation = ?3, updated_at = strftime('%s','now') * 1000
                 where root_path = ?1 and path = ?2 and source_generation <= ?3",
                params![root_key, path, generation as i64],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn remove_semantic_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
) -> Result<(), String> {
    for path in paths.iter().map(|path| normalize_path(path)) {
        connection
            .execute(
                "delete from workspace_semantic_file_layers where root_path = ?1 and path = ?2",
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn clear_semantic_layers(connection: &Connection, root_key: &str) -> Result<(), String> {
    connection
        .execute(
            "delete from workspace_semantic_file_layers where root_path = ?1",
            [root_key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn load_semantic_layers(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<Vec<WorkspaceSemanticLayerReadiness>, String> {
    let path = normalize_path(path);
    let mut statement = connection
        .prepare(
            "select layer, status, source_generation, dependency_generation,
                    producer_version, result_count, error, updated_at
             from workspace_semantic_file_layers
             where root_path = ?1 and path = ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, path], |row| {
            Ok(WorkspaceSemanticLayerReadiness {
                layer: row.get(0)?,
                status: row.get(1)?,
                source_generation: Some(row.get::<_, i64>(2)? as u64),
                dependency_generation: Some(row.get::<_, i64>(3)? as u64),
                producer_version: Some(row.get(4)?),
                result_count: row.get(5)?,
                error: row.get(6)?,
                updated_at: Some(row.get(7)?),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut by_layer = rows
        .into_iter()
        .map(|row| (row.layer.clone(), row))
        .collect::<HashMap<_, _>>();
    Ok(SEMANTIC_LAYERS
        .iter()
        .map(|layer| {
            by_layer
                .remove(*layer)
                .unwrap_or_else(|| WorkspaceSemanticLayerReadiness::missing(layer))
        })
        .collect())
}

fn publish_counted_layers(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    generation: u64,
    layer: &str,
    table: &str,
    path_column: &str,
) -> Result<(), String> {
    for path in source_paths(paths) {
        let count = count_path_rows(connection, table, path_column, root_key, &path)?;
        publish_semantic_layer(
            connection, root_key, &path, layer, "ready", generation, count, None,
        )?;
    }
    Ok(())
}

fn count_path_rows(
    connection: &Connection,
    table: &str,
    path_column: &str,
    root_key: &str,
    path: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            &format!("select count(*) from {table} where root_path = ?1 and {path_column} = ?2"),
            params![root_key, path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn source_paths(paths: &[String]) -> impl Iterator<Item = String> + '_ {
    paths
        .iter()
        .map(|path| normalize_path(path))
        .filter(|path| is_source_file(path))
}

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

fn normalize_path(path: &str) -> String {
    path.replace('/', "\\")
}
