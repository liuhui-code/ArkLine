#![allow(dead_code)]

use rusqlite::{params, Connection};

use crate::models::language::{CompletionItem, LanguageQueryRequest};
use crate::models::workspace::{
    WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness, WorkspaceIndexState, WorkspaceIndexStatus,
};
use crate::services::workspace_completion_expected_type_service::expected_completion_type;
use crate::services::workspace_completion_item_service::{
    completion_item, dedupe_completion_items, snippet_completion_item, symbol_completion_from_row,
};
use crate::services::workspace_completion_parser_service::{
    completion_prefix, local_function_name, local_variable_name, member_owner_at_position,
};
use crate::services::workspace_completion_sdk_service::{
    sdk_member_completion_items, sdk_symbol_completion_items,
};
use crate::services::workspace_index_connection_service::{
    require_existing_workspace_index_reader, workspace_index_store_path, WorkspaceIndexReader,
};
use crate::services::workspace_index_readiness_service::readiness_for_query;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_reference_receiver_type_service::receiver_type_map;

const KEYWORDS: &[&str] = &[
    "public",
    "private",
    "protected",
    "readonly",
    "static",
    "async",
    "await",
    "export",
    "import",
    "class",
    "interface",
    "struct",
    "function",
    "let",
    "const",
];

struct CompletionSnippet {
    label: &'static str,
    detail: &'static str,
    insert_text: &'static str,
}

const SNIPPETS: &[CompletionSnippet] = &[
    CompletionSnippet {
        label: "struct component",
        detail: "ArkTS component struct",
        insert_text: "#[Entry]\n#[Component]\nstruct ${1:Index} {\n  build() {\n    ${0}\n  }\n}",
    },
    CompletionSnippet {
        label: "build method",
        detail: "ArkUI build method",
        insert_text: "build() {\n  ${0}\n}",
    },
];

pub fn query_semantic_completions(
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<Vec<CompletionItem>, String> {
    let prefix = completion_prefix(request);
    let mut items = Vec::new();
    items.extend(keyword_items(&prefix));
    if let Some(content) = request.content.as_deref() {
        items.extend(local_scope_items(content, &prefix));
        if member_owner_at_position(request).is_some() {
            items.extend(member_items(root_path, request, content, &prefix)?);
            return Ok(dedupe_completion_items(items, limit));
        }
    }
    items.extend(project_symbol_items(root_path, &prefix, limit)?);
    items.extend(sdk_symbol_completion_items(root_path, &prefix, limit)?);
    items.extend(snippet_items(&prefix));
    apply_expected_type_boost(&mut items, request);
    Ok(dedupe_completion_items(items, limit))
}

pub fn query_semantic_completions_with_readiness(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    request: &LanguageQueryRequest,
    limit: usize,
) -> Result<WorkspaceIndexQueryEnvelope<CompletionItem>, String> {
    let readiness = readiness_for_index_state(&index_runtime.get_index_state(root_path)?);
    let items = query_semantic_completions(root_path, request, limit)?;
    Ok(WorkspaceIndexQueryEnvelope {
        items,
        readiness,
        explain: Vec::new(),
        next_cursor: None,
    })
}

fn keyword_items(prefix: &str) -> Vec<CompletionItem> {
    if prefix.is_empty() {
        return Vec::new();
    }
    KEYWORDS
        .iter()
        .filter(|keyword| keyword.starts_with(prefix))
        .map(|keyword| completion_item(keyword, "keyword", "ArkTS keyword", "keyword", None))
        .collect()
}

fn local_scope_items(content: &str, prefix: &str) -> Vec<CompletionItem> {
    if prefix.is_empty() {
        return Vec::new();
    }
    let mut items = Vec::new();
    for line in content.lines() {
        if let Some(name) = local_variable_name(line) {
            if name.starts_with(prefix) {
                items.push(completion_item(
                    name,
                    "variable",
                    "Local variable",
                    "local",
                    None,
                ));
            }
        }
        if let Some(name) = local_function_name(line) {
            if name.starts_with(prefix) {
                items.push(completion_item(
                    &format!("{name}()"),
                    "function",
                    "Local function",
                    "local",
                    None,
                ));
            }
        }
    }
    items
}

fn snippet_items(prefix: &str) -> Vec<CompletionItem> {
    if prefix.is_empty() {
        return Vec::new();
    }
    SNIPPETS
        .iter()
        .filter(|snippet| snippet.label.starts_with(prefix))
        .map(|snippet| {
            snippet_completion_item(snippet.label, snippet.detail, snippet.insert_text, "arkts")
        })
        .collect()
}

fn apply_expected_type_boost(items: &mut [CompletionItem], request: &LanguageQueryRequest) {
    let Some(expected_type) = expected_completion_type(request) else {
        return;
    };
    for item in items.iter_mut() {
        if item.label.trim_end_matches("()") == expected_type {
            item.sort_text = Some("00_expected_type".to_string());
        }
    }
    items.sort_by(|left, right| {
        left.sort_text
            .as_deref()
            .unwrap_or("10_default")
            .cmp(right.sort_text.as_deref().unwrap_or("10_default"))
    });
}

fn member_items(
    root_path: &str,
    request: &LanguageQueryRequest,
    content: &str,
    prefix: &str,
) -> Result<Vec<CompletionItem>, String> {
    let Some(owner) = member_owner_at_position(request) else {
        return Ok(Vec::new());
    };
    let Some(receiver_type) = receiver_type_map(content)
        .get(&owner)
        .cloned()
        .or_else(|| inline_receiver_type(&owner))
    else {
        return Ok(Vec::new());
    };
    if !index_store_exists(root_path) {
        return Ok(Vec::new());
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let path_key = normalize_index_path(&request.path);
    let receiver_type =
        resolved_import_target_name(&connection, &root_key, &path_key, &receiver_type)?
            .unwrap_or(receiver_type);
    let mut items = project_member_items(&connection, &root_key, &receiver_type, &prefix)?;
    items.extend(sdk_member_completion_items(
        root_path,
        &connection,
        &root_key,
        &receiver_type,
        prefix,
    )?);
    Ok(items)
}

fn project_member_items(
    connection: &Connection,
    root_key: &str,
    receiver_type: &str,
    prefix: &str,
) -> Result<Vec<CompletionItem>, String> {
    let mut statement = connection
        .prepare(
            "select name, kind, signature, path, line, column, symbol_id
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and container is not null
               and (container = ?2 or container like ?3)
               and name like ?4
             order by name, path, line
             limit ?5",
        )
        .map_err(|error| error.to_string())?;
    let pattern = format!("{}%", escape_like_pattern(prefix));
    let suffix = format!("%.{}", receiver_type);
    let rows = statement
        .query_map(
            params![root_key, receiver_type, suffix, pattern, 50_i64],
            |row| symbol_completion_from_row(row, "workspace", true),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn inline_receiver_type(owner: &str) -> Option<String> {
    owner
        .strip_suffix("()")
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn project_symbol_items(
    root_path: &str,
    prefix: &str,
    limit: usize,
) -> Result<Vec<CompletionItem>, String> {
    if prefix.is_empty() {
        return Ok(Vec::new());
    }
    if !index_store_exists(root_path) {
        return Ok(Vec::new());
    }
    let connection = open_index_store(root_path)?;
    let root_key = normalize_index_path(root_path);
    let pattern = format!("{}%", escape_like_pattern(prefix));
    let mut statement = connection
        .prepare(
            "select name, kind, signature, path, line, column, symbol_id
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and container is null
               and name like ?2
             order by name, path, line
             limit ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, pattern, bounded_limit(limit)], |row| {
            symbol_completion_from_row(row, "workspace", true)
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn readiness_for_index_state(state: &WorkspaceIndexState) -> WorkspaceIndexReadiness {
    let root_path = state.root_path.as_deref().unwrap_or_default();
    let served_generation = state.indexed_at.and_then(|value| u64::try_from(value).ok());
    let requested_generation = match state.status {
        WorkspaceIndexStatus::Stale | WorkspaceIndexStatus::Failed => {
            served_generation.unwrap_or_default().saturating_add(1)
        }
        _ => served_generation.unwrap_or_default(),
    };
    let partial_reason = match state.status {
        WorkspaceIndexStatus::Partial => {
            state.partial_reason.as_deref().or(Some("Index is partial"))
        }
        _ => None,
    };
    readiness_for_query(
        root_path,
        requested_generation,
        served_generation,
        partial_reason,
    )
}

fn resolved_import_target_name(
    connection: &Connection,
    root_key: &str,
    path: &str,
    local_name: &str,
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "select target.name
             from workspace_resolved_symbols alias
             join workspace_resolved_symbols target
               on target.root_path = alias.root_path
              and target.symbol_id = alias.target_symbol_id
             where alias.root_path = ?1
               and alias.path = ?2
               and alias.name = ?3
               and alias.source = 'import'
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key, path, local_name], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
}

fn open_index_store(root_path: &str) -> Result<WorkspaceIndexReader<'static>, String> {
    require_existing_workspace_index_reader(root_path)
}

fn index_store_exists(root_path: &str) -> bool {
    workspace_index_store_path(root_path).is_file()
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn bounded_limit(limit: usize) -> i64 {
    i64::try_from(limit.clamp(1, 500)).unwrap_or(500)
}
