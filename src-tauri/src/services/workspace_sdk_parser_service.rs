use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSdkSymbol {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub container: Option<String>,
    pub signature: Option<String>,
}

pub fn collect_sdk_symbols(sdk_path: &str) -> Result<Vec<WorkspaceSdkSymbol>, String> {
    let mut symbols = Vec::new();
    collect_sdk_symbols_in_dir(Path::new(sdk_path), &mut symbols)?;
    symbols.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.column.cmp(&right.column))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(symbols)
}

fn collect_sdk_symbols_in_dir(
    directory: &Path,
    symbols: &mut Vec<WorkspaceSdkSymbol>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| error.to_string())?;
    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            collect_sdk_symbols_in_dir(&path, symbols)?;
        } else if is_sdk_source_file(&path) {
            let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            symbols.extend(index_sdk_document(&path.to_string_lossy(), &content));
        }
    }
    Ok(())
}

fn index_sdk_document(path: &str, content: &str) -> Vec<WorkspaceSdkSymbol> {
    let mut symbols = Vec::new();
    let mut contexts: Vec<SdkParseContext> = Vec::new();

    for (line_index, line_text) in content.lines().enumerate() {
        let trimmed = line_text.trim_start();
        if trimmed.starts_with('}') {
            contexts.pop();
            continue;
        }

        if let Some((name, _column)) = namespace_symbol(line_text) {
            contexts.push(SdkParseContext {
                kind: SdkParseContextKind::Namespace,
                name,
            });
            if !trimmed.ends_with('{') {
                contexts.pop();
            }
            continue;
        }

        if let Some((kind, name, column)) = declaration_symbol(line_text) {
            let namespace = namespace_path(&contexts);
            let container = namespace.clone();
            let qualified_type_name = qualified_name(namespace.as_deref(), &name);
            symbols.push(WorkspaceSdkSymbol {
                kind: kind.to_string(),
                name,
                path: normalize_index_path(path),
                line: line_index + 1,
                column,
                container,
                signature: Some(trimmed.to_string()),
            });
            if matches!(kind, "class" | "interface" | "enum") && trimmed.ends_with('{') {
                contexts.push(SdkParseContext {
                    kind: SdkParseContextKind::Type,
                    name: qualified_type_name,
                });
            } else if matches!(kind, "class" | "interface" | "enum") {
                symbols.extend(inline_container_members(
                    line_text,
                    kind,
                    &qualified_type_name,
                    path,
                    line_index + 1,
                ));
            }
            continue;
        }

        if let Some(container_name) = type_path(&contexts) {
            if let Some((kind, name, column)) = member_symbol(trimmed, line_text) {
                symbols.push(WorkspaceSdkSymbol {
                    kind,
                    name,
                    path: normalize_index_path(path),
                    line: line_index + 1,
                    column,
                    container: Some(container_name.clone()),
                    signature: Some(trimmed.to_string()),
                });
            }
        }
    }

    symbols
}

fn inline_container_members(
    line_text: &str,
    declaration_kind: &str,
    container_name: &str,
    path: &str,
    line: usize,
) -> Vec<WorkspaceSdkSymbol> {
    let Some(body_start) = line_text.find('{') else {
        return Vec::new();
    };
    let Some(body_end) = line_text.rfind('}') else {
        return Vec::new();
    };
    if body_end <= body_start {
        return Vec::new();
    }

    let body = &line_text[body_start + 1..body_end];
    let separator = if declaration_kind == "enum" { ',' } else { ';' };
    body.split(separator)
        .filter_map(|segment| {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                return None;
            }
            let (kind, name, relative_column) = member_symbol(trimmed, trimmed)?;
            Some(WorkspaceSdkSymbol {
                kind,
                name,
                path: normalize_index_path(path),
                line,
                column: body_start + 1 + body.find(trimmed).unwrap_or(0) + relative_column,
                container: Some(container_name.to_string()),
                signature: Some(trimmed.to_string()),
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SdkParseContext {
    kind: SdkParseContextKind,
    name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SdkParseContextKind {
    Namespace,
    Type,
}

fn namespace_path(contexts: &[SdkParseContext]) -> Option<String> {
    let names = contexts
        .iter()
        .filter(|context| context.kind == SdkParseContextKind::Namespace)
        .map(|context| context.name.as_str())
        .collect::<Vec<_>>();
    (!names.is_empty()).then(|| names.join("."))
}

fn type_path(contexts: &[SdkParseContext]) -> Option<String> {
    contexts
        .iter()
        .rev()
        .find(|context| context.kind == SdkParseContextKind::Type)
        .map(|context| context.name.to_string())
}

fn qualified_name(prefix: Option<&str>, name: &str) -> String {
    prefix
        .filter(|value| !value.is_empty())
        .map(|value| format!("{value}.{name}"))
        .unwrap_or_else(|| name.to_string())
}

fn namespace_symbol(line_text: &str) -> Option<(String, usize)> {
    for keyword in ["namespace", "module"] {
        let Some(index) = line_text.find(keyword) else {
            continue;
        };
        let after_keyword = line_text.get(index + keyword.len()..)?.trim_start();
        let skipped = line_text.get(index + keyword.len()..)?.len() - after_keyword.len();
        let name = identifier_prefix(after_keyword)?;
        return Some((name.to_string(), index + keyword.len() + skipped + 1));
    }
    None
}

fn declaration_symbol(line_text: &str) -> Option<(&'static str, String, usize)> {
    for keyword in ["class", "interface", "enum", "function", "type"] {
        let Some(index) = find_keyword(line_text, keyword) else {
            continue;
        };
        let after_keyword = line_text.get(index + keyword.len()..)?.trim_start();
        let skipped = line_text.get(index + keyword.len()..)?.len() - after_keyword.len();
        let name = identifier_prefix(after_keyword)?;
        return Some((
            keyword,
            name.to_string(),
            index + keyword.len() + skipped + 1,
        ));
    }
    None
}

fn find_keyword(value: &str, keyword: &str) -> Option<usize> {
    value.match_indices(keyword).find_map(|(index, _)| {
        let before = value.get(..index)?.chars().next_back();
        let after = value.get(index + keyword.len()..)?.chars().next();
        let before_ok = before.is_none_or(|character| !is_identifier_character(character));
        let after_ok = after.is_none_or(|character| !is_identifier_character(character));
        (before_ok && after_ok).then_some(index)
    })
}

fn member_symbol(trimmed: &str, original: &str) -> Option<(String, String, usize)> {
    let candidate = strip_member_modifiers(trimmed);
    let name = identifier_prefix(candidate)?;
    let kind = if member_suffix_after_name(candidate, name.len()).starts_with('(') {
        "method"
    } else {
        "property"
    };
    Some((
        kind.to_string(),
        name.to_string(),
        original.find(name).unwrap_or(0) + 1,
    ))
}

fn member_suffix_after_name(candidate: &str, name_length: usize) -> &str {
    let mut suffix = candidate
        .get(name_length..)
        .unwrap_or_default()
        .trim_start();
    suffix = suffix.strip_prefix('?').unwrap_or(suffix).trim_start();
    if let Some(stripped) = strip_type_parameters(suffix) {
        suffix = stripped.trim_start();
    }
    suffix
}

fn strip_type_parameters(value: &str) -> Option<&str> {
    let mut depth = 0usize;
    for (index, character) in value.char_indices() {
        match character {
            '<' => depth += 1,
            '>' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return value.get(index + character.len_utf8()..);
                }
            }
            _ if depth == 0 => return None,
            _ => {}
        }
    }
    None
}

fn strip_member_modifiers(mut value: &str) -> &str {
    loop {
        let next = [
            "public",
            "private",
            "protected",
            "static",
            "readonly",
            "abstract",
            "declare",
            "export",
            "override",
        ]
        .iter()
        .find_map(|modifier| strip_keyword_prefix(value, modifier));
        let Some(stripped) = next else {
            return value;
        };
        value = stripped.trim_start();
    }
}

fn strip_keyword_prefix<'a>(value: &'a str, keyword: &str) -> Option<&'a str> {
    value.strip_prefix(keyword).filter(|remaining| {
        remaining
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_whitespace())
    })
}

fn is_sdk_source_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension, "d.ts" | "ets" | "ts"))
        || path.to_string_lossy().ends_with(".d.ts")
}

fn identifier_prefix(value: &str) -> Option<&str> {
    let end = value
        .char_indices()
        .take_while(|(index, character)| {
            if *index == 0 {
                is_identifier_start(*character)
            } else {
                is_identifier_character(*character)
            }
        })
        .last()
        .map(|(index, character)| index + character.len_utf8())?;
    value.get(..end)
}

fn is_identifier_start(character: char) -> bool {
    character.is_ascii_alphabetic() || character == '_' || character == '$'
}

fn is_identifier_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '$'
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}
