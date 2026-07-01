use crate::models::workspace::*;

const DECLARATION_KEYWORDS: &[&str] = &["struct", "class", "interface", "enum", "type", "function"];
const MEMBER_MODIFIERS: &[&str] = &[
    "public",
    "private",
    "protected",
    "static",
    "readonly",
    "async",
    "abstract",
    "override",
    "declare",
];

#[derive(Debug, Clone)]
struct ContainerScope {
    name: String,
    close_depth: i32,
}

#[derive(Debug, Clone)]
struct DeclarationMatch {
    kind: String,
    name: String,
    column: usize,
    modifiers: Vec<String>,
    visibility: Option<String>,
    signature: String,
}

pub fn parse_arkts_file_stub(path: &str, content: &str) -> ArkTsFileStub {
    let mut stub = ArkTsFileStub {
        path: path.to_string(),
        module_name: module_name_from_path(path),
        imports: Vec::new(),
        exports: Vec::new(),
        declarations: Vec::new(),
        parse_errors: Vec::new(),
    };
    let mut decorators = Vec::new();
    let mut containers: Vec<ContainerScope> = Vec::new();
    let mut depth = 0_i32;

    for (line_index, raw_line) in content.lines().enumerate() {
        let line = line_index + 1;
        let code = strip_line_comment(raw_line);
        let trimmed = code.trim_start();
        let leading = code.len() - trimmed.len();

        if trimmed.is_empty() {
            continue;
        }

        let (after_decorators, found_decorators) = take_leading_decorators(trimmed);
        decorators.extend(found_decorators);
        if after_decorators.is_empty() {
            depth += brace_delta(trimmed);
            continue;
        }

        stub.imports
            .extend(parse_imports(after_decorators, line, leading + 1));
        stub.exports
            .extend(parse_named_exports(after_decorators, line, leading + 1));

        if let Some(declaration) =
            parse_declaration(after_decorators, raw_line, line, &containers, &decorators)
        {
            let inline_members =
                parse_inline_members(after_decorators, raw_line, line, &declaration.name);
            if declaration
                .modifiers
                .iter()
                .any(|modifier| modifier == "export")
            {
                stub.exports.push(ArkTsExportStub {
                    exported_name: if declaration
                        .modifiers
                        .iter()
                        .any(|modifier| modifier == "default")
                    {
                        "default".to_string()
                    } else {
                        declaration.name.clone()
                    },
                    local_name: Some(declaration.name.clone()),
                    source_module: None,
                    is_default: declaration
                        .modifiers
                        .iter()
                        .any(|modifier| modifier == "default"),
                    line,
                    column: declaration.column,
                });
            }
            if is_container_kind(&declaration.kind) && brace_delta(after_decorators) > 0 {
                containers.push(ContainerScope {
                    name: declaration.name.clone(),
                    close_depth: depth + brace_delta(after_decorators),
                });
            }
            stub.declarations.push(declaration);
            stub.declarations.extend(inline_members);
            decorators.clear();
        } else if let Some(member) =
            parse_member(after_decorators, raw_line, line, &containers, &decorators)
        {
            stub.declarations.push(member);
            decorators.clear();
        }

        depth += brace_delta(after_decorators);
        if depth < 0 {
            stub.parse_errors.push(ArkTsParseError {
                message: "Unexpected closing brace".to_string(),
                line,
                column: raw_line.find('}').unwrap_or(0) + 1,
            });
            depth = 0;
        }
        while containers
            .last()
            .is_some_and(|container| depth < container.close_depth)
        {
            containers.pop();
        }
    }

    if depth > 0 {
        stub.parse_errors.push(ArkTsParseError {
            message: "Unclosed block".to_string(),
            line: content.lines().count().max(1),
            column: 1,
        });
    }
    stub
}

fn parse_declaration(
    value: &str,
    original: &str,
    line: usize,
    containers: &[ContainerScope],
    decorators: &[String],
) -> Option<ArkTsDeclarationStub> {
    let declaration = declaration_match(value, original)?;
    let container = containers.last().map(|scope| scope.name.clone());
    let qualified_name = container
        .as_ref()
        .map(|parent| format!("{parent}.{}", declaration.name))
        .unwrap_or_else(|| declaration.name.clone());
    Some(ArkTsDeclarationStub {
        kind: declaration.kind,
        name: declaration.name,
        qualified_name,
        container,
        visibility: declaration.visibility,
        modifiers: declaration.modifiers,
        decorators: decorators.to_vec(),
        signature: declaration.signature,
        line,
        column: declaration.column,
        end_line: line,
        end_column: original.len().max(declaration.column),
    })
}

fn parse_inline_members(
    value: &str,
    original: &str,
    line: usize,
    container_name: &str,
) -> Vec<ArkTsDeclarationStub> {
    let Some(start) = value.find('{') else {
        return Vec::new();
    };
    let Some(end) = value.rfind('}') else {
        return Vec::new();
    };
    if end <= start {
        return Vec::new();
    }
    let body = value[start + 1..end].trim();
    if body.is_empty() {
        return Vec::new();
    }
    let scope = vec![ContainerScope {
        name: container_name.to_string(),
        close_depth: 0,
    }];
    body.split(';')
        .flat_map(|part| part.split("}"))
        .filter_map(|part| parse_member(part.trim(), original, line, &scope, &[]))
        .collect()
}

fn parse_member(
    value: &str,
    original: &str,
    line: usize,
    containers: &[ContainerScope],
    decorators: &[String],
) -> Option<ArkTsDeclarationStub> {
    let container = containers.last()?.name.clone();
    if is_control_statement(value) {
        return None;
    }
    let (candidate, modifiers, visibility) = strip_modifiers(value);
    let name = identifier_prefix(candidate)?;
    let suffix = member_suffix(candidate, name.len());
    if !suffix.starts_with('(') && !suffix.starts_with(':') && !suffix.starts_with('?') {
        return None;
    }
    let kind = if suffix.starts_with('(') {
        "method"
    } else {
        "property"
    };
    let column = original.find(name).unwrap_or(0) + 1;
    Some(ArkTsDeclarationStub {
        kind: kind.to_string(),
        name: name.to_string(),
        qualified_name: format!("{container}.{name}"),
        container: Some(container),
        visibility,
        modifiers,
        decorators: decorators.to_vec(),
        signature: signature_text(value),
        line,
        column,
        end_line: line,
        end_column: original.len().max(column),
    })
}

fn declaration_match(value: &str, original: &str) -> Option<DeclarationMatch> {
    let (candidate, modifiers, visibility) = strip_modifiers(value);
    for keyword in DECLARATION_KEYWORDS {
        let Some(index) = find_word(candidate, keyword) else {
            continue;
        };
        let after_keyword = candidate.get(index + keyword.len()..)?.trim_start();
        let name = identifier_prefix(after_keyword)?;
        let column = original.find(name).unwrap_or(0) + 1;
        return Some(DeclarationMatch {
            kind: keyword.to_string(),
            name: name.to_string(),
            column,
            modifiers,
            visibility,
            signature: signature_text(value),
        });
    }
    None
}

fn parse_imports(value: &str, line: usize, column: usize) -> Vec<ArkTsImportStub> {
    let Some(rest) = value.strip_prefix("import") else {
        return Vec::new();
    };
    let rest = rest.trim_start();
    let (rest, is_type_only) = rest
        .strip_prefix("type ")
        .map(|typed| (typed.trim_start(), true))
        .unwrap_or((rest, false));
    let Some((bindings, source)) = split_module_clause(rest) else {
        return Vec::new();
    };
    parse_binding_list(bindings)
        .into_iter()
        .map(|(imported_name, local_name)| ArkTsImportStub {
            source_module: source.clone(),
            imported_name,
            local_name,
            is_type_only,
            line,
            column,
        })
        .collect()
}

fn parse_named_exports(value: &str, line: usize, column: usize) -> Vec<ArkTsExportStub> {
    let Some(rest) = value.strip_prefix("export") else {
        return Vec::new();
    };
    let rest = rest.trim_start();
    if !rest.starts_with('{') {
        return Vec::new();
    }
    let Some((bindings, source)) = split_export_clause(rest) else {
        return Vec::new();
    };
    parse_binding_list(bindings)
        .into_iter()
        .map(|(local_name, exported_name)| ArkTsExportStub {
            exported_name,
            local_name,
            source_module: source.clone(),
            is_default: false,
            line,
            column,
        })
        .collect()
}

fn parse_binding_list(value: &str) -> Vec<(Option<String>, String)> {
    let inner = value
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .trim();
    if inner.is_empty() {
        return identifier_prefix(value.trim())
            .map(|name| vec![(Some("default".to_string()), name.to_string())])
            .unwrap_or_default();
    }
    inner
        .split(',')
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }
            if let Some((imported, local)) = trimmed.split_once(" as ") {
                return Some((Some(imported.trim().to_string()), local.trim().to_string()));
            }
            Some((Some(trimmed.to_string()), trimmed.to_string()))
        })
        .collect()
}

fn split_module_clause(value: &str) -> Option<(&str, String)> {
    let (bindings, source_part) = value.split_once(" from ")?;
    Some((bindings.trim(), quoted_value(source_part)?))
}

fn split_export_clause(value: &str) -> Option<(&str, Option<String>)> {
    if let Some((bindings, source_part)) = value.split_once(" from ") {
        return Some((bindings.trim(), Some(quoted_value(source_part)?)));
    }
    Some((value.trim(), None))
}

fn quoted_value(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches(';').trim();
    let quote = trimmed.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = trimmed[1..].find(quote)?;
    Some(trimmed[1..1 + end].to_string())
}

fn take_leading_decorators(mut value: &str) -> (&str, Vec<String>) {
    let mut decorators = Vec::new();
    loop {
        let trimmed = value.trim_start();
        if !trimmed.starts_with('@') {
            return (trimmed, decorators);
        }
        let Some(name) = decorator_prefix(trimmed) else {
            return (trimmed, decorators);
        };
        decorators.push(name.to_string());
        value = trimmed.get(name.len()..).unwrap_or_default();
    }
}

fn strip_modifiers(mut value: &str) -> (&str, Vec<String>, Option<String>) {
    let mut modifiers = Vec::new();
    let mut visibility = None;
    loop {
        let Some(word) = identifier_prefix(value.trim_start()) else {
            return (value.trim_start(), modifiers, visibility);
        };
        if word == "export" || word == "default" || MEMBER_MODIFIERS.contains(&word) {
            if matches!(word, "public" | "private" | "protected") {
                visibility = Some(word.to_string());
            }
            modifiers.push(word.to_string());
            value = value.trim_start().get(word.len()..).unwrap_or_default();
            continue;
        }
        return (value.trim_start(), modifiers, visibility);
    }
}

fn member_suffix(candidate: &str, name_length: usize) -> &str {
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
                    return value.get(index + 1..);
                }
            }
            _ if depth == 0 => return None,
            _ => {}
        }
    }
    None
}

fn signature_text(value: &str) -> String {
    value
        .split('{')
        .next()
        .unwrap_or(value)
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string()
}

fn module_name_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.to_string())
}

fn strip_line_comment(value: &str) -> &str {
    value.split("//").next().unwrap_or(value)
}

fn brace_delta(value: &str) -> i32 {
    value.chars().fold(0, |sum, character| match character {
        '{' => sum + 1,
        '}' => sum - 1,
        _ => sum,
    })
}

fn is_container_kind(kind: &str) -> bool {
    matches!(kind, "struct" | "class" | "interface" | "enum")
}

fn is_control_statement(value: &str) -> bool {
    ["if", "for", "while", "switch", "catch"]
        .iter()
        .any(|keyword| {
            value
                .strip_prefix(keyword)
                .is_some_and(|rest| rest.starts_with(' ') || rest.starts_with('('))
        })
}

fn find_word(value: &str, word: &str) -> Option<usize> {
    value.match_indices(word).find_map(|(index, _)| {
        let before = value.get(..index)?.chars().next_back();
        let after = value.get(index + word.len()..)?.chars().next();
        let before_ok = before.is_none_or(|character| !is_identifier_character(character));
        let after_ok = after.is_none_or(|character| !is_identifier_character(character));
        (before_ok && after_ok).then_some(index)
    })
}

fn decorator_prefix(value: &str) -> Option<&str> {
    let name = value.strip_prefix('@')?;
    let identifier = identifier_prefix(name)?;
    value.get(..identifier.len() + 1)
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
    is_identifier_start(character) || character.is_ascii_digit()
}
