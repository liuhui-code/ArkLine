use std::time::{Duration, Instant};

use rusqlite::{params, Connection, Statement};

use crate::models::workspace::{ArkTsDeclarationStub, ArkTsFileStub};
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceStubWriteProfile {
    pub write_duration: Duration,
}

pub(crate) fn insert_parsed_stub_rows(
    connection: &Connection,
    root_key: &str,
    stubs: &[ArkTsFileStub],
    indexed_generation: u64,
) -> Result<WorkspaceStubWriteProfile, String> {
    let mut file_statement = stub_file_insert_statement(connection)?;
    let mut declaration_statement = stub_declaration_insert_statement(connection)?;
    let mut import_statement = stub_import_insert_statement(connection)?;
    let mut export_statement = stub_export_insert_statement(connection)?;
    let mut error_statement = stub_parse_error_insert_statement(connection)?;
    let mut profile = WorkspaceStubWriteProfile::default();

    for stub in stubs {
        let write_start = Instant::now();
        insert_stub_file(&mut file_statement, root_key, stub, indexed_generation)?;
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
        profile.write_duration += write_start.elapsed();
    }
    Ok(profile)
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

fn stub_entity_id(path: &str, declaration: &ArkTsDeclarationStub) -> String {
    format!(
        "stub:{}:{}:{}:{}:{}",
        declaration.kind, declaration.qualified_name, path, declaration.line, declaration.column
    )
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}
