use std::fs;
use std::path::Path;

use rusqlite::{params, Connection};

use crate::models::workspace::{ArkTsDeclarationStub, ArkTsFileStub};
use crate::services::workspace_arkts_stub_parser_service::parse_arkts_file_stub;

pub const ARKTS_STUB_PARSER_VERSION: i64 = 1;

pub fn replace_all_stub_rows(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    delete_all_stub_rows(connection, root_key)?;
    insert_stub_rows_for_files(connection, root_key, file_paths, indexed_generation)
}

pub fn replace_changed_stub_rows(
    connection: &Connection,
    root_key: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    let mut affected_paths = changed_paths
        .iter()
        .chain(removed_paths.iter())
        .map(|path| normalize_index_path(path))
        .collect::<Vec<_>>();
    affected_paths.sort();
    affected_paths.dedup();

    for path in &affected_paths {
        delete_stub_rows_for_path(connection, root_key, path)?;
    }
    insert_stub_rows_for_files(connection, root_key, changed_paths, indexed_generation)
}

fn insert_stub_rows_for_files(
    connection: &Connection,
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
) -> Result<(), String> {
    for path in file_paths.iter().map(|path| normalize_index_path(path)) {
        if !is_source_file(&path) {
            continue;
        }
        let Some(stub) = parse_stub_from_file(&path) else {
            continue;
        };
        insert_stub_file(connection, root_key, &stub, indexed_generation)?;
        for declaration in &stub.declarations {
            insert_stub_declaration(connection, root_key, &stub.path, declaration)?;
        }
        for import in &stub.imports {
            connection
                .execute(
                    "insert into workspace_stub_imports (
                        root_path, path, source_module, imported_name, local_name,
                        is_type_only, line, column
                     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        root_key,
                        stub.path,
                        import.source_module,
                        import.imported_name,
                        import.local_name,
                        bool_to_i64(import.is_type_only),
                        import.line as i64,
                        import.column as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for export in &stub.exports {
            connection
                .execute(
                    "insert into workspace_stub_exports (
                        root_path, path, exported_name, local_name, source_module,
                        is_default, line, column
                     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        root_key,
                        stub.path,
                        export.exported_name,
                        export.local_name,
                        export.source_module,
                        bool_to_i64(export.is_default),
                        export.line as i64,
                        export.column as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for error in &stub.parse_errors {
            connection
                .execute(
                    "insert into workspace_stub_parse_errors (
                        root_path, path, message, line, column
                     ) values (?1, ?2, ?3, ?4, ?5)",
                    params![
                        root_key,
                        stub.path,
                        error.message,
                        error.line as i64,
                        error.column as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
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
    connection: &Connection,
    root_key: &str,
    stub: &ArkTsFileStub,
    indexed_generation: u64,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_stub_files (
                root_path, path, parser_version, indexed_generation, parse_status, error_count
             ) values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                root_key,
                stub.path,
                ARKTS_STUB_PARSER_VERSION,
                indexed_generation as i64,
                if stub.parse_errors.is_empty() { "ok" } else { "error" },
                stub.parse_errors.len() as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_stub_declaration(
    connection: &Connection,
    root_key: &str,
    path: &str,
    declaration: &ArkTsDeclarationStub,
) -> Result<(), String> {
    connection
        .execute(
            "insert into workspace_stub_declarations (
                root_path, path, entity_id, kind, name, qualified_name, container, visibility,
                signature, line, column, end_line, end_column, modifiers_json, decorators_json
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
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
                serde_json::to_string(&declaration.modifiers).map_err(|error| error.to_string())?,
                serde_json::to_string(&declaration.decorators).map_err(|error| error.to_string())?,
            ],
        )
        .map_err(|error| error.to_string())?;
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

fn delete_stub_rows_for_path(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<(), String> {
    for table in STUB_TABLES {
        connection
            .execute(
                &format!("delete from {table} where root_path = ?1 and path = ?2"),
                params![root_key, path],
            )
            .map_err(|error| error.to_string())?;
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

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn bool_to_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

const STUB_TABLES: &[&str] = &[
    "workspace_stub_files",
    "workspace_stub_declarations",
    "workspace_stub_imports",
    "workspace_stub_exports",
    "workspace_stub_parse_errors",
];
