use rusqlite::{params, Connection, OptionalExtension};

use crate::services::workspace_dependency_graph_model_service::{DependencyGraphStatus, ImportRow};

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

pub(crate) fn record_dependency_graph_status(
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

pub(crate) fn load_import_rows(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ImportRow>, String> {
    load_module_rows(
        connection,
        root_key,
        "select path, source_module, line, column
         from workspace_stub_imports
         where root_path = ?1
         order by path, line, column",
    )
}

pub(crate) fn load_re_export_rows(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ImportRow>, String> {
    load_module_rows(
        connection,
        root_key,
        "select path, source_module, line, column
         from workspace_stub_exports
         where root_path = ?1 and source_module is not null
         order by path, line, column",
    )
}

pub(crate) fn load_import_rows_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
) -> Result<Vec<ImportRow>, String> {
    load_module_rows_for_paths(
        connection,
        root_key,
        paths,
        "select path, source_module, line, column
         from workspace_stub_imports
         where root_path = ?1 and path = ?2
         order by line, column",
    )
}

pub(crate) fn load_re_export_rows_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
) -> Result<Vec<ImportRow>, String> {
    load_module_rows_for_paths(
        connection,
        root_key,
        paths,
        "select path, source_module, line, column
         from workspace_stub_exports
         where root_path = ?1 and path = ?2 and source_module is not null
         order by line, column",
    )
}

fn load_module_rows_for_paths(
    connection: &Connection,
    root_key: &str,
    paths: &[String],
    sql: &str,
) -> Result<Vec<ImportRow>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for path in paths {
        let rows = statement
            .query_map(params![root_key, path], map_module_row)
            .map_err(|error| error.to_string())?;
        result.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(result)
}

fn load_module_rows(
    connection: &Connection,
    root_key: &str,
    sql: &str,
) -> Result<Vec<ImportRow>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], map_module_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn map_module_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ImportRow> {
    let line: i64 = row.get(2)?;
    let column: i64 = row.get(3)?;
    Ok(ImportRow {
        from_path: row.get(0)?,
        source_module: row.get(1)?,
        line: usize::try_from(line).unwrap_or_default(),
        column: usize::try_from(column).unwrap_or_default(),
    })
}

pub(crate) fn insert_dependency_edge(
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

pub(crate) fn insert_unresolved_import(
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
