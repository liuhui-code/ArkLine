use rusqlite::params;

use crate::services::workspace_index_connection_service::{
    require_existing_workspace_index_reader, WorkspaceIndexReader,
};

use crate::models::language::{DefinitionCandidate, LanguageQueryRequest};
use crate::services::workspace_reference_index_service::query_reference_at_position;
use crate::services::workspace_sdk_shared_bridge_service::query_shared_sdk_symbol_by_id;
use crate::services::workspace_symbol_identity_merge_service::query_merged_symbol_ids;
use crate::services::workspace_symbol_resolution_query_service::query_resolved_symbol_by_id;

pub fn query_reference_definition_candidates(
    root_path: &str,
    request: &LanguageQueryRequest,
) -> Result<Vec<DefinitionCandidate>, String> {
    let Some(reference) =
        query_reference_at_position(root_path, &request.path, request.line, request.column)?
    else {
        return Ok(Vec::new());
    };
    let Some(symbol_id) = reference.symbol_id else {
        return Ok(Vec::new());
    };
    let mut candidates = Vec::new();
    for merged_id in query_merged_symbol_ids(root_path, &symbol_id)? {
        candidates.extend(query_definition_by_symbol_id(root_path, &merged_id)?);
    }
    dedupe_definition_candidates(&mut candidates);
    Ok(candidates)
}

fn query_definition_by_symbol_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    if symbol_id.starts_with("sdk:") {
        return query_sdk_definition_by_symbol_id(root_path, symbol_id);
    }
    if symbol_id.starts_with("project:") {
        return query_project_definition_by_symbol_id(root_path, symbol_id);
    }
    Ok(Vec::new())
}

fn query_project_definition_by_symbol_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    let Some(symbol) = query_resolved_symbol_by_id(root_path, symbol_id)? else {
        return Ok(Vec::new());
    };
    Ok(vec![DefinitionCandidate {
        path: denormalize_index_path(&symbol.path),
        line: u32::try_from(symbol.line).unwrap_or_default(),
        column: u32::try_from(symbol.column).unwrap_or_default(),
        preview: symbol.signature.unwrap_or(symbol.qualified_name),
    }])
}

fn query_sdk_definition_by_symbol_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Vec<DefinitionCandidate>, String> {
    if let Ok(Some(symbol)) = query_shared_sdk_symbol_by_id(root_path, symbol_id) {
        return Ok(vec![DefinitionCandidate {
            path: denormalize_index_path(&symbol.path),
            line: u32::try_from(symbol.line).unwrap_or_default(),
            column: u32::try_from(symbol.column).unwrap_or_default(),
            preview: symbol.signature.unwrap_or_else(|| {
                symbol
                    .container
                    .map(|container| format!("{container}.{}", symbol.name))
                    .unwrap_or(symbol.name)
            }),
        }]);
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let mut statement = connection
        .prepare(
            "select symbol.path, symbol.line, symbol.column, symbol.signature,
                    symbol.container, symbol.name
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1
               and symbol.symbol_id = ?2
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, symbol_id], |row| {
            let line: i64 = row.get(1)?;
            let column: i64 = row.get(2)?;
            let signature: Option<String> = row.get(3)?;
            let container: Option<String> = row.get(4)?;
            let name: String = row.get(5)?;
            Ok(DefinitionCandidate {
                path: denormalize_index_path(&row.get::<_, String>(0)?),
                line: u32::try_from(line).unwrap_or_default(),
                column: u32::try_from(column).unwrap_or_default(),
                preview: signature.unwrap_or_else(|| {
                    container
                        .map(|container| format!("{container}.{name}"))
                        .unwrap_or(name)
                }),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<WorkspaceIndexReader<'static>, String> {
    require_existing_workspace_index_reader(root_path)
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn dedupe_definition_candidates(candidates: &mut Vec<DefinitionCandidate>) {
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|candidate| {
        seen.insert((candidate.path.clone(), candidate.line, candidate.column))
    });
}
