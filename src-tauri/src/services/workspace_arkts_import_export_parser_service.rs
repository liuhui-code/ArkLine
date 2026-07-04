use crate::models::workspace::{ArkTsExportStub, ArkTsImportStub};

pub(crate) fn parse_imports(value: &str, line: usize, column: usize) -> Vec<ArkTsImportStub> {
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

pub(crate) fn parse_named_exports(value: &str, line: usize, column: usize) -> Vec<ArkTsExportStub> {
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

fn identifier_prefix(value: &str) -> Option<&str> {
    let end = value
        .char_indices()
        .take_while(|(index, character)| {
            if *index == 0 {
                character.is_ascii_alphabetic() || *character == '_' || *character == '$'
            } else {
                character.is_ascii_alphanumeric() || *character == '_' || *character == '$'
            }
        })
        .last()
        .map(|(index, character)| index + character.len_utf8())?;
    value.get(..end)
}
