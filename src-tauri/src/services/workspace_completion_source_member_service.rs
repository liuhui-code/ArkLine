use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

use crate::models::language::{CompletionItem, DefinitionTarget};
use crate::models::workspace::ArkTsFileStub;
use crate::services::workspace_arkts_stub_parser_service::parse_arkts_file_stub;
use crate::services::workspace_completion_item_service::completion_item;
use crate::services::workspace_dependency_graph_resolver_service::{
    is_relative_module, relative_import_candidates,
};

const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MEMBER_ITEMS: usize = 50;

pub(super) fn source_member_items(
    root_path: &str,
    request_path: &str,
    content: &str,
    receiver_type: &str,
    prefix: &str,
    include_non_public: bool,
) -> Vec<CompletionItem> {
    let source_stub = parse_arkts_file_stub(request_path, content);
    if declares_container(&source_stub, receiver_type) {
        return member_items_from_stub(&source_stub, receiver_type, prefix, include_non_public);
    }
    let Some(import) = source_stub.imports.iter().find(|candidate| {
        candidate.local_name == receiver_type && is_relative_module(&candidate.source_module)
    }) else {
        return Vec::new();
    };
    let Some(target_path) =
        resolve_workspace_import(root_path, request_path, &import.source_module)
    else {
        return Vec::new();
    };
    let Some(target_content) = read_bounded_source(&target_path) else {
        return Vec::new();
    };
    let target_path_text = target_path.to_string_lossy().to_string();
    let target_stub = parse_arkts_file_stub(&target_path_text, &target_content);
    let target_name = import
        .imported_name
        .as_deref()
        .filter(|name| *name != "default")
        .unwrap_or(receiver_type);
    member_items_from_stub(&target_stub, target_name, prefix, include_non_public)
}

fn resolve_workspace_import(
    root_path: &str,
    request_path: &str,
    source_module: &str,
) -> Option<PathBuf> {
    let root = Path::new(root_path).canonicalize().ok()?;
    relative_import_candidates(request_path, source_module)
        .into_iter()
        .map(|candidate| native_path(&candidate))
        .filter_map(|candidate| candidate.canonicalize().ok())
        .find(|candidate| candidate.starts_with(&root) && candidate.is_file())
}

fn native_path(value: &str) -> PathBuf {
    if MAIN_SEPARATOR == '\\' {
        PathBuf::from(value)
    } else {
        PathBuf::from(value.replace('\\', &MAIN_SEPARATOR.to_string()))
    }
}

fn read_bounded_source(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn declares_container(stub: &ArkTsFileStub, receiver_type: &str) -> bool {
    stub.declarations.iter().any(|declaration| {
        declaration.container.is_none()
            && declaration.name == receiver_type
            && matches!(declaration.kind.as_str(), "class" | "struct" | "interface")
    })
}

fn member_items_from_stub(
    stub: &ArkTsFileStub,
    receiver_type: &str,
    prefix: &str,
    include_non_public: bool,
) -> Vec<CompletionItem> {
    stub.declarations
        .iter()
        .filter(|declaration| {
            declaration
                .container
                .as_deref()
                .is_some_and(|container| container == receiver_type)
                && declaration.name.starts_with(prefix)
                && matches!(declaration.kind.as_str(), "method" | "property")
                && (include_non_public
                    || !matches!(
                        declaration.visibility.as_deref(),
                        Some("private" | "protected")
                    ))
        })
        .take(MAX_MEMBER_ITEMS)
        .map(|declaration| {
            let label = if declaration.kind == "method" {
                format!("{}()", declaration.name)
            } else {
                declaration.name.clone()
            };
            let mut item = completion_item(
                &label,
                &declaration.kind,
                &declaration.signature,
                "workspace-source",
                None,
            );
            item.definition_target = Some(DefinitionTarget {
                path: stub.path.replace('\\', "/"),
                line: u32::try_from(declaration.line).unwrap_or_default(),
                column: u32::try_from(declaration.column).unwrap_or_default(),
            });
            item
        })
        .collect()
}
