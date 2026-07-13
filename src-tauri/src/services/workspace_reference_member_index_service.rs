use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::{params, Connection, Statement};

use crate::services::workspace_reference_generic_receiver_service::{
    generic_class_fields, GenericClass,
};
use crate::services::workspace_reference_member_access_parser_service::{
    contains_member_access_line, is_identifier, member_accesses, MemberAccess,
};
use crate::services::workspace_reference_receiver_type_service::receiver_type_maps_by_line;

pub struct WorkspaceMemberReferenceContext {
    sdk_targets: Vec<MemberTarget>,
    project_targets: Vec<MemberTarget>,
}

impl WorkspaceMemberReferenceContext {
    pub fn load(connection: &Connection, root_key: &str) -> Result<Self, String> {
        let sdk_targets = load_sdk_member_targets(connection, root_key)?;
        let project_targets = load_project_member_targets(connection, root_key)?;
        Ok(Self {
            sdk_targets,
            project_targets,
        })
    }
}

#[allow(dead_code)]
pub fn index_workspace_member_references(
    connection: &Connection,
    root_key: &str,
    path: &str,
    content: &str,
    indexed_generation: u64,
) -> Result<(), String> {
    let context = WorkspaceMemberReferenceContext::load(connection, root_key)?;
    index_workspace_member_references_with_context(
        connection,
        root_key,
        path,
        content,
        indexed_generation,
        &context,
    )
}

pub fn index_workspace_member_references_with_context(
    connection: &Connection,
    root_key: &str,
    path: &str,
    content: &str,
    indexed_generation: u64,
    context: &WorkspaceMemberReferenceContext,
) -> Result<(), String> {
    if !contains_member_access(content) {
        return Ok(());
    }
    let import_type_targets = load_import_type_targets(connection, root_key, path)?;
    let unresolved_import_types = load_unresolved_import_type_names(connection, root_key, path)?;
    let imported_generic_classes = load_imported_generic_classes(&import_type_targets);
    let receiver_types_by_line = receiver_type_maps_by_line(content, &imported_generic_classes);
    let mut inserter = MemberReferenceInserter::new(connection)?;
    for (line_index, line) in content.lines().enumerate() {
        if is_declaration_like_line(line) {
            continue;
        }
        let mut receiver_types = receiver_types_by_line
            .get(line_index)
            .cloned()
            .unwrap_or_default();
        for member in member_accesses(line) {
            let project_target = receiver_types
                .get(member.owner)
                .and_then(|receiver_type| {
                    resolve_project_member_target(
                        &context.project_targets,
                        &import_type_targets,
                        &unresolved_import_types,
                        receiver_type,
                        member.name,
                    )
                })
                .or_else(|| {
                    if !member.owner.contains('.') {
                        return None;
                    }
                    resolve_project_member_target(
                        &context.project_targets,
                        &import_type_targets,
                        &unresolved_import_types,
                        member.owner,
                        member.name,
                    )
                });
            let sdk_target = context
                .sdk_targets
                .iter()
                .find(|target| target.matches(member.owner, member.name));
            inserter.insert(
                root_key,
                path,
                &member,
                project_target.or(sdk_target),
                line_index as i64 + 1,
                indexed_generation,
            )?;
            if let Some(return_type) = project_target.and_then(|target| target.return_type.as_ref())
            {
                receiver_types
                    .entry(format!("{}.{}", member.owner, member.name))
                    .or_insert_with(|| return_type.to_string());
            }
        }
    }
    Ok(())
}

fn load_imported_generic_classes(
    import_targets: &[ImportTypeTarget],
) -> HashMap<String, GenericClass> {
    let mut classes = HashMap::new();
    for target in import_targets {
        let Ok(content) = fs::read_to_string(filesystem_path(&target.path)) else {
            continue;
        };
        let generic_classes = generic_class_fields(&content);
        let Some(generic_class) = generic_classes
            .get(&target.target_name)
            .or_else(|| generic_classes.get(&target.target_qualified_name))
        else {
            continue;
        };
        classes.insert(target.local_name.clone(), generic_class.clone());
    }
    classes
}

pub(crate) fn contains_member_access(content: &str) -> bool {
    content
        .lines()
        .filter(|line| !is_declaration_like_line(line))
        .any(contains_member_access_line)
}

fn filesystem_path(path: &str) -> String {
    if Path::new(path).exists() {
        return path.to_string();
    }
    path.replace('\\', "/")
}

struct MemberReferenceInserter<'a> {
    statement: Statement<'a>,
}

impl<'a> MemberReferenceInserter<'a> {
    fn new(connection: &'a Connection) -> Result<Self, String> {
        Ok(Self {
            statement: connection
                .prepare(
                    "insert or replace into workspace_symbol_references (
                        root_path, path, reference_id, symbol_id, name, kind, container,
                        line, column, end_line, end_column, confidence, indexed_generation
                     ) values (?1, ?2, ?3, ?4, ?5, 'memberAccess', ?6, ?7, ?8, ?7, ?9, ?10, ?11)",
                )
                .map_err(|error| error.to_string())?,
        })
    }

    fn insert(
        &mut self,
        root_key: &str,
        path: &str,
        member: &MemberAccess<'_>,
        target: Option<&MemberTarget>,
        line: i64,
        indexed_generation: u64,
    ) -> Result<(), String> {
        let column = member.column as i64;
        let end_column = member.end_column as i64;
        let symbol_id = target.map(MemberTarget::symbol_id);
        let confidence = if symbol_id.is_some() {
            "memberResolved"
        } else {
            "unresolvedLikely"
        };
        self.statement
            .execute(params![
                root_key,
                path,
                format!(
                    "{path}:memberAccess:{}:{}:{}:{}",
                    member.owner, member.name, line, column
                ),
                symbol_id,
                member.name,
                member.owner,
                line,
                column,
                end_column,
                confidence,
                indexed_generation as i64,
            ])
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn load_sdk_member_targets(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<MemberTarget>, String> {
    let mut statement = connection
        .prepare(
            "select symbol.symbol_id, symbol.kind, symbol.name, symbol.path, symbol.line, symbol.column,
                    symbol.container
             from workspace_sdk_symbols symbol
             inner join workspace_sdk_index_metadata metadata
                on metadata.root_path = symbol.root_path
               and metadata.sdk_path = symbol.sdk_path
               and metadata.sdk_version = symbol.sdk_version
             where symbol.root_path = ?1 and symbol.container is not null
             order by symbol.name, symbol.container, symbol.path, symbol.line",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(MemberTarget {
                symbol_id: row.get(0)?,
                name: row.get(2)?,
                path: row.get(3)?,
                container: row.get(6)?,
                return_type: None,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_project_member_targets(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<MemberTarget>, String> {
    let mut statement = connection
        .prepare(
            "select symbol_id, kind, name, path, line, column, container, signature
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and container is not null
             order by name, container, path, line",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(MemberTarget {
                symbol_id: row.get(0)?,
                name: row.get(2)?,
                path: row.get(3)?,
                container: row.get(6)?,
                return_type: row
                    .get::<_, Option<String>>(7)?
                    .as_deref()
                    .and_then(signature_member_type)
                    .map(str::to_string),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_import_type_targets(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<Vec<ImportTypeTarget>, String> {
    let mut statement = connection
        .prepare(
            "select alias.name, target.path, target.name, target.qualified_name
             from workspace_resolved_symbols alias
             join workspace_resolved_symbols target
               on target.root_path = alias.root_path
              and target.symbol_id = alias.target_symbol_id
             where alias.root_path = ?1
               and alias.path = ?2
               and alias.source = 'import'
               and target.source = 'project'
             order by alias.line, alias.column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, path], |row| {
            Ok(ImportTypeTarget {
                local_name: row.get(0)?,
                path: row.get(1)?,
                target_name: row.get(2)?,
                target_qualified_name: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_unresolved_import_type_names(
    connection: &Connection,
    root_key: &str,
    path: &str,
) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare(
            "select name
             from workspace_unresolved_symbols
             where root_path = ?1
               and path = ?2
               and reason like 'unresolved import%'
             order by line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, path], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())
}

fn resolve_project_member_target<'a>(
    project_targets: &'a [MemberTarget],
    import_type_targets: &[ImportTypeTarget],
    unresolved_import_types: &HashSet<String>,
    receiver_type: &str,
    member_name: &str,
) -> Option<&'a MemberTarget> {
    if let Some(import_target) = import_type_targets
        .iter()
        .find(|target| target.local_name == receiver_type)
    {
        return project_targets.iter().find(|target| {
            target.path == import_target.path
                && target.name == member_name
                && (target.matches(&import_target.target_name, member_name)
                    || target.matches(&import_target.target_qualified_name, member_name))
        });
    }
    if unresolved_import_types.contains(receiver_type) {
        return None;
    }
    project_targets
        .iter()
        .find(|target| target.matches(receiver_type, member_name))
}

fn is_declaration_like_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("import ") || trimmed.starts_with("export ")
}

struct MemberTarget {
    symbol_id: String,
    name: String,
    path: String,
    container: String,
    return_type: Option<String>,
}

struct ImportTypeTarget {
    local_name: String,
    path: String,
    target_name: String,
    target_qualified_name: String,
}

impl MemberTarget {
    fn matches(&self, owner: &str, name: &str) -> bool {
        self.name == name
            && (self.container == owner
                || self
                    .container
                    .rsplit('.')
                    .next()
                    .is_some_and(|segment| segment == owner))
    }

    fn symbol_id(&self) -> String {
        self.symbol_id.clone()
    }
}

fn signature_member_type(signature: &str) -> Option<&str> {
    if let Some(return_start) = signature.rfind("):") {
        return normalized_member_type(signature.get(return_start + 2..)?.trim_start());
    }
    let (_, type_expression) = signature.split_once(':')?;
    normalized_member_type(type_expression.trim_start())
}

fn normalized_member_type(type_expression: &str) -> Option<&str> {
    let type_expression = type_expression.strip_prefix('?').unwrap_or(type_expression);
    if let Some(inner) = type_expression.strip_prefix("Promise<") {
        let end = inner.find('>')?;
        let type_name = inner.get(..end)?.trim();
        if is_identifier(type_name) {
            return Some(type_name);
        }
        return None;
    }
    let end = type_expression
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(type_expression.len());
    let type_name = type_expression.get(..end)?;
    if !is_identifier(type_name) {
        return None;
    }
    Some(type_name)
}
