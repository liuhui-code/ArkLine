use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, Statement};

use crate::models::workspace::{ArkTsDeclarationStub, ArkTsFileStub};
use crate::services::workspace_arkts_stub_parser_service::parse_arkts_file_stub;
use crate::services::workspace_dependency_graph_service::{
    rebuild_dependency_graph, update_dependency_graph_for_paths,
};
use crate::services::workspace_reference_index_service::{
    replace_workspace_references, replace_workspace_references_for_paths,
};
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
    insert_stub_rows_for_files(connection, root_key, file_paths, indexed_generation)?;
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
) -> Result<(), String> {
    let plan = plan_workspace_stub_refresh(changed_paths, removed_paths);

    delete_stub_rows_for_paths(connection, root_key, &plan.affected_paths)?;
    insert_stub_rows_for_files(
        connection,
        root_key,
        &plan.indexed_paths,
        indexed_generation,
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
) -> Result<(), String> {
    insert_stub_rows_for_files_profiled(connection, root_key, file_paths, indexed_generation, None)
}

fn insert_stub_rows_for_files_profiled(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    mut profile: Option<&mut WorkspaceStubInsertProfile>,
) -> Result<(), String> {
    let mut file_statement = stub_file_insert_statement(connection)?;
    let mut declaration_statement = stub_declaration_insert_statement(connection)?;
    let mut import_statement = stub_import_insert_statement(connection)?;
    let mut export_statement = stub_export_insert_statement(connection)?;
    let mut error_statement = stub_parse_error_insert_statement(connection)?;
    for path in file_paths.iter().map(|path| normalize_index_path(path)) {
        if !is_source_file(&path) {
            continue;
        }
        let parse_start = Instant::now();
        let Some(stub) = parse_stub_from_file(&path) else {
            continue;
        };
        if let Some(profile) = profile.as_mut() {
            profile.parse_duration += parse_start.elapsed();
        }
        let write_start = Instant::now();
        insert_stub_file(&mut file_statement, root_key, &stub, indexed_generation)?;
        for declaration in &stub.declarations {
            insert_stub_declaration(
                &mut declaration_statement,
                root_key,
                &stub.path,
                declaration,
            )?;
        }
        for import in &stub.imports {
            import_statement
                .execute(params![
                    root_key,
                    stub.path,
                    import.source_module,
                    import.imported_name,
                    import.local_name,
                    bool_to_i64(import.is_type_only),
                    import.line as i64,
                    import.column as i64,
                ])
                .map_err(|error| error.to_string())?;
        }
        for export in &stub.exports {
            export_statement
                .execute(params![
                    root_key,
                    stub.path,
                    export.exported_name,
                    export.local_name,
                    export.source_module,
                    bool_to_i64(export.is_default),
                    export.line as i64,
                    export.column as i64,
                ])
                .map_err(|error| error.to_string())?;
        }
        for error in &stub.parse_errors {
            error_statement
                .execute(params![
                    root_key,
                    stub.path,
                    error.message,
                    error.line as i64,
                    error.column as i64,
                ])
                .map_err(|error| error.to_string())?;
        }
        if let Some(profile) = profile.as_mut() {
            profile.write_duration += write_start.elapsed();
        }
    }
    Ok(())
}

fn parse_stub_from_file(path: &str) -> Option<ArkTsFileStub> {
    let filesystem_path = filesystem_path(path);
    let content = fs::read_to_string(filesystem_path).ok()?;
    Some(parse_arkts_file_stub(path, &content))
}

fn insert_stub_file(
    statement: &mut Statement<'_>,
    root_key: &str,
    stub: &ArkTsFileStub,
    indexed_generation: u64,
) -> Result<(), String> {
    statement
        .execute(params![
            root_key,
            stub.path,
            ARKTS_STUB_PARSER_VERSION,
            indexed_generation as i64,
            if stub.parse_errors.is_empty() {
                "ok"
            } else {
                "error"
            },
            stub.parse_errors.len() as i64,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_stub_declaration(
    statement: &mut Statement<'_>,
    root_key: &str,
    path: &str,
    declaration: &ArkTsDeclarationStub,
) -> Result<(), String> {
    let modifiers_json = json_string_array(&declaration.modifiers)?;
    let decorators_json = json_string_array(&declaration.decorators)?;
    statement
        .execute(params![
            root_key,
            path,
            stub_entity_id(path, declaration),
            declaration.kind,
            declaration.name,
            declaration.qualified_name,
            declaration.container,
            declaration.visibility,
            declaration.signature,
            declaration.line as i64,
            declaration.column as i64,
            declaration.end_line as i64,
            declaration.end_column as i64,
            modifiers_json,
            decorators_json,
        ])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn json_string_array(values: &[String]) -> Result<String, String> {
    if values.is_empty() {
        return Ok("[]".to_string());
    }
    serde_json::to_string(values).map_err(|error| error.to_string())
}

fn stub_file_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_stub_files (
                root_path, path, parser_version, indexed_generation, parse_status, error_count
             ) values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|error| error.to_string())
}

fn stub_declaration_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_stub_declarations (
                root_path, path, entity_id, kind, name, qualified_name, container, visibility,
                signature, line, column, end_line, end_column, modifiers_json, decorators_json
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )
        .map_err(|error| error.to_string())
}

fn stub_import_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_stub_imports (
                root_path, path, source_module, imported_name, local_name,
                is_type_only, line, column
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(|error| error.to_string())
}

fn stub_export_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_stub_exports (
                root_path, path, exported_name, local_name, source_module,
                is_default, line, column
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(|error| error.to_string())
}

fn stub_parse_error_insert_statement(connection: &Connection) -> Result<Statement<'_>, String> {
    connection
        .prepare(
            "insert into workspace_stub_parse_errors (
                root_path, path, message, line, column
             ) values (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|error| error.to_string())
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

fn stub_entity_id(path: &str, declaration: &ArkTsDeclarationStub) -> String {
    format!(
        "stub:{}:{}:{}:{}:{}",
        declaration.kind, declaration.qualified_name, path, declaration.line, declaration.column
    )
}

fn filesystem_path(path: &str) -> String {
    if Path::new(path).exists() {
        return path.to_string();
    }
    path.replace('\\', "/")
}

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

pub(crate) fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

const STUB_TABLES: &[&str] = &[
    "workspace_stub_files",
    "workspace_stub_declarations",
    "workspace_stub_imports",
    "workspace_stub_exports",
    "workspace_stub_parse_errors",
];
