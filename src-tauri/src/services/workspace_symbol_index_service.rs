use std::fs;

use crate::models::workspace::{WorkspaceIndexedSymbol, WorkspaceSearchCandidate};

const DECLARATION_KEYWORDS: &[&str] = &["struct", "class", "interface", "enum", "type", "function"];
const MEMBER_MODIFIERS: &[&str] = &[
    "public",
    "private",
    "protected",
    "static",
    "readonly",
    "async",
];

pub fn index_workspace_symbols(file_paths: &[String]) -> Vec<WorkspaceIndexedSymbol> {
    let mut symbols = Vec::new();

    for path in file_paths {
        if !is_source_file(path) {
            continue;
        }

        let file_path = filesystem_path(path);
        let Ok(content) = fs::read_to_string(&file_path) else {
            continue;
        };

        symbols.extend(index_document_symbols(path, &content));
    }

    symbols
}

pub fn update_workspace_symbols(
    current_symbols: &[WorkspaceIndexedSymbol],
    changed_paths: &[String],
    removed_paths: &[String],
) -> Vec<WorkspaceIndexedSymbol> {
    let changed = changed_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<std::collections::HashSet<_>>();
    let removed = removed_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .collect::<std::collections::HashSet<_>>();
    let mut symbols = current_symbols
        .iter()
        .filter(|symbol| {
            let path = normalize_index_path(&symbol.path);
            !changed.contains(&path) && !removed.contains(&path)
        })
        .cloned()
        .collect::<Vec<_>>();

    symbols.extend(index_workspace_symbols(changed_paths));
    symbols.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.column.cmp(&right.column))
            .then_with(|| left.name.cmp(&right.name))
    });
    symbols
}

pub fn index_document_symbols(path: &str, content: &str) -> Vec<WorkspaceIndexedSymbol> {
    let mut symbols = Vec::new();
    let mut container_stack: Vec<(String, i32)> = Vec::new();
    let mut depth = 0_i32;

    for (line_index, line_text) in content.lines().enumerate() {
        let trimmed = line_text.trim_start();

        if let Some((kind, name, column)) = declaration_symbol(line_text) {
            let source = if is_class_like_kind(kind) {
                "class"
            } else {
                "symbol"
            };
            symbols.push(WorkspaceIndexedSymbol {
                source: source.to_string(),
                kind: kind.to_string(),
                name: name.clone(),
                path: path.to_string(),
                line: line_index + 1,
                column,
                container: container_stack
                    .last()
                    .map(|(container, _)| container.clone()),
                signature: None,
                visibility: None,
            });

            if is_class_like_kind(kind) && line_text.contains('{') {
                container_stack.push((name, depth + brace_delta(line_text)));
            }
        } else if let Some((name, column)) = method_symbol(trimmed, line_text) {
            if let Some((container, _)) = container_stack.last() {
                symbols.push(WorkspaceIndexedSymbol {
                    source: "symbol".to_string(),
                    kind: "method".to_string(),
                    name,
                    path: path.to_string(),
                    line: line_index + 1,
                    column,
                    container: Some(container.clone()),
                    signature: None,
                    visibility: None,
                });
            }
        }

        depth += brace_delta(line_text);
        while container_stack
            .last()
            .is_some_and(|(_, container_depth)| depth < *container_depth)
        {
            container_stack.pop();
        }
    }

    symbols
}

pub fn query_index_symbols(
    symbols: &[WorkspaceIndexedSymbol],
    query: &str,
    limit: usize,
) -> Vec<WorkspaceSearchCandidate> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut ranked = symbols
        .iter()
        .filter_map(|symbol| score_symbol(symbol, &trimmed).map(|score| (symbol, score)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.name.cmp(&right.0.name))
    });

    ranked
        .into_iter()
        .take(limit)
        .map(|(symbol, score)| WorkspaceSearchCandidate {
            id: format!(
                "{}:{}:{}:{}",
                symbol.source, symbol.path, symbol.line, symbol.column
            ),
            source: symbol.source.clone(),
            kind: symbol.kind.clone(),
            title: symbol.name.clone(),
            subtitle: symbol
                .container
                .as_ref()
                .map(|container| format!("{container} · {}", symbol.path))
                .unwrap_or_else(|| symbol.path.clone()),
            path: Some(symbol.path.clone()),
            line: Some(symbol.line),
            column: Some(symbol.column),
            score,
            freshness: "ready".to_string(),
            container: symbol.container.clone(),
            signature: symbol.signature.clone(),
            visibility: symbol.visibility.clone(),
        })
        .collect()
}

fn declaration_symbol(line_text: &str) -> Option<(&'static str, String, usize)> {
    for keyword in DECLARATION_KEYWORDS {
        let Some(index) = find_word(line_text, keyword) else {
            continue;
        };
        let name_start = index + keyword.len();
        let after_keyword = line_text.get(name_start..)?.trim_start();
        let skipped = line_text.get(name_start..)?.len() - after_keyword.len();
        let name = identifier_prefix(after_keyword)?;
        return Some((keyword, name.to_string(), name_start + skipped + 1));
    }

    None
}

fn method_symbol(trimmed: &str, original: &str) -> Option<(String, usize)> {
    let candidate = trim_modifiers(trimmed);
    let paren_index = candidate.find('(')?;
    if candidate[..paren_index].contains(' ')
        || candidate.starts_with("if")
        || candidate.starts_with("for")
    {
        return None;
    }

    let name = identifier_prefix(candidate)?;
    if name.len() != paren_index {
        return None;
    }

    Some((name.to_string(), original.find(name).unwrap_or(0) + 1))
}

fn trim_modifiers(mut value: &str) -> &str {
    loop {
        let Some((first, rest)) = value.split_once(char::is_whitespace) else {
            return value;
        };
        if !MEMBER_MODIFIERS.contains(&first) {
            return value;
        }
        value = rest.trim_start();
    }
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

fn find_word(line_text: &str, word: &str) -> Option<usize> {
    let index = line_text.find(word)?;
    let left_ok = index == 0
        || !line_text[..index]
            .chars()
            .next_back()
            .is_some_and(is_identifier_char);
    let right_index = index + word.len();
    let right_ok = right_index >= line_text.len()
        || !line_text[right_index..]
            .chars()
            .next()
            .is_some_and(is_identifier_char);
    left_ok.then_some(index).filter(|_| right_ok)
}

fn is_identifier_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_' || value == '$'
}

fn is_class_like_kind(kind: &str) -> bool {
    matches!(kind, "struct" | "class" | "interface" | "enum" | "type")
}

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}

fn filesystem_path(path: &str) -> String {
    if std::path::Path::new(path).exists() {
        return path.to_string();
    }

    path.replace('\\', "/")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn brace_delta(line_text: &str) -> i32 {
    line_text
        .chars()
        .fold(0, |depth, character| match character {
            '{' => depth + 1,
            '}' => depth - 1,
            _ => depth,
        })
}

fn score_symbol(symbol: &WorkspaceIndexedSymbol, query: &str) -> Option<f64> {
    let name = symbol.name.to_lowercase();
    if name == query {
        return Some(120.0);
    }
    if name.starts_with(query) {
        return Some(90.0 - name.len() as f64 * 0.01);
    }
    if name.contains(query) {
        return Some(60.0 - name.len() as f64 * 0.01);
    }
    fuzzy_score(&name, query).map(|score| score - name.len() as f64 * 0.01)
}

fn fuzzy_score(value: &str, query: &str) -> Option<f64> {
    let mut score = 0.0;
    let mut query_chars = query.chars();
    let mut current = query_chars.next()?;
    for character in value.chars() {
        if character == current {
            score += 4.0;
            if let Some(next) = query_chars.next() {
                current = next;
            } else {
                return Some(score);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{index_document_symbols, query_index_symbols, update_workspace_symbols};
    use crate::models::workspace::WorkspaceIndexedSymbol;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn indexes_classes_functions_and_methods_from_arkts_documents() {
        let symbols = index_document_symbols(
            "/workspace/entry/src/main/ets/pages/Index.ets",
            "export struct Index {\n  public build() {\n  }\n}\nfunction submitForm() {}\n",
        );

        assert_eq!(symbols[0].source, "class");
        assert_eq!(symbols[0].name, "Index");
        assert_eq!(symbols[1].kind, "method");
        assert_eq!(symbols[1].name, "build");
        assert_eq!(symbols[1].container.as_deref(), Some("Index"));
        assert_eq!(symbols[2].source, "symbol");
        assert_eq!(symbols[2].name, "submitForm");
    }

    #[test]
    fn queries_class_and_symbol_candidates_by_name() {
        let symbols = index_document_symbols(
            "/workspace/Index.ets",
            "class LoginController {\n  private submitLogin() {}\n}\n",
        );

        let matches = query_index_symbols(&symbols, "login", 8);

        assert_eq!(matches[0].source, "class");
        assert_eq!(matches[0].title, "LoginController");
        assert_eq!(matches[1].source, "symbol");
        assert_eq!(matches[1].title, "submitLogin");
    }

    #[test]
    fn updates_symbols_for_changed_added_and_removed_paths() {
        let root = unique_temp_dir("workspace-symbol-incremental");
        fs::create_dir_all(root.join("entry").join("src")).unwrap();
        let kept_path = root.join("entry").join("src").join("Kept.ets");
        let added_path = root.join("entry").join("src").join("Added.ets");
        let removed_path = root.join("entry").join("src").join("Removed.ets");
        fs::write(&kept_path, "class KeptNew {}").unwrap();
        fs::write(&added_path, "class AddedSymbol {}").unwrap();
        let symbols = vec![
            WorkspaceIndexedSymbol {
                source: "class".to_string(),
                kind: "class".to_string(),
                name: "KeptOld".to_string(),
                path: kept_path.to_string_lossy().to_string(),
                line: 1,
                column: 1,
                container: None,
                signature: None,
                visibility: None,
            },
            WorkspaceIndexedSymbol {
                source: "class".to_string(),
                kind: "class".to_string(),
                name: "RemovedSymbol".to_string(),
                path: removed_path.to_string_lossy().to_string(),
                line: 1,
                column: 1,
                container: None,
                signature: None,
                visibility: None,
            },
        ];

        let updated = update_workspace_symbols(
            &symbols,
            &[
                kept_path.to_string_lossy().to_string(),
                added_path.to_string_lossy().to_string(),
            ],
            &[removed_path.to_string_lossy().to_string()],
        );

        assert!(updated.iter().any(|symbol| symbol.name == "KeptNew"));
        assert!(updated.iter().any(|symbol| symbol.name == "AddedSymbol"));
        assert!(!updated.iter().any(|symbol| symbol.name == "KeptOld"));
        assert!(!updated.iter().any(|symbol| symbol.name == "RemovedSymbol"));

        fs::remove_dir_all(root).unwrap();
    }
}
