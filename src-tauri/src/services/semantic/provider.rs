use crate::models::language::{
    CompletionItem, DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse,
    LanguageQueryRequest, LanguageServiceReport, UsageResult,
};
use crate::services::document_service::read_text_file;
use std::path::Path;

pub trait SemanticProvider: Send + Sync {
    fn report(&self) -> LanguageServiceReport;
    fn hover(&self, request: &LanguageQueryRequest) -> Option<HoverResponse>;
    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget>;
    fn definition_candidates(&self, request: &LanguageQueryRequest) -> Vec<DefinitionCandidate>;
    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem>;
    fn document_symbols(&self, request: &LanguageQueryRequest) -> Vec<DocumentSymbol>;
    fn usages(&self, request: &LanguageQueryRequest) -> Vec<UsageResult>;
}

pub struct FallbackProvider {
    detail: String,
}

impl Default for FallbackProvider {
    fn default() -> Self {
        Self::new(
            "Fallback semantic provider is active; ArkTS SDK-backed semantic service is unavailable"
                .to_string(),
        )
    }
}

impl FallbackProvider {
    pub fn new(detail: String) -> Self {
        Self { detail }
    }
}

impl SemanticProvider for FallbackProvider {
    fn report(&self) -> LanguageServiceReport {
        LanguageServiceReport {
            provider: "fallback".to_string(),
            mode: "fallback".to_string(),
            running: true,
            hover: false,
            definition: true,
            completion: true,
            document_symbols: true,
            find_usages: true,
            detail: self.detail.clone(),
        }
    }

    fn hover(&self, _request: &LanguageQueryRequest) -> Option<HoverResponse> {
        None
    }

    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
        let content = load_document_content(&request.path)?;
        let symbol = symbol_at_position(&content, request)?;

        collect_document_symbols(&content)
            .into_iter()
            .find(|candidate| candidate.name == symbol)
            .map(|candidate| DefinitionTarget {
                path: request.path.clone(),
                line: candidate.line,
                column: candidate.column,
            })
    }

    fn definition_candidates(&self, request: &LanguageQueryRequest) -> Vec<DefinitionCandidate> {
        let Some(content) = load_document_content(&request.path) else {
            return Vec::new();
        };
        let Some(symbol) = symbol_at_position(&content, request) else {
            return Vec::new();
        };

        collect_document_symbols(&content)
            .into_iter()
            .filter(|candidate| candidate.name == symbol)
            .map(|candidate| DefinitionCandidate {
                path: request.path.clone(),
                line: candidate.line,
                column: candidate.column,
                preview: content
                    .lines()
                    .nth(candidate.line.saturating_sub(1) as usize)
                    .map(|line| line.trim().to_string())
                    .unwrap_or_default(),
            })
            .collect()
    }

    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
        let Some(content) = load_document_content(&request.path) else {
            return Vec::new();
        };

        let mut items = Vec::new();
        let mut seen = Vec::<String>::new();
        let mut push = |label: String, detail: &str, kind: &str| {
            if seen.iter().any(|existing| existing == &label) {
                return;
            }

            seen.push(label.clone());
            items.push(CompletionItem {
                label,
                detail: detail.to_string(),
                kind: kind.to_string(),
                insert_text: None,
                filter_text: None,
                sort_text: None,
                source: None,
                documentation: None,
                replacement_range: None,
                commit_characters: Vec::new(),
                definition_target: None,
                data: None,
            });
        };

        if content.contains("@Entry") {
            push("@Entry".to_string(), "ArkTS decorator", "keyword");
        }

        if content.contains("@Component") {
            push("@Component".to_string(), "ArkTS decorator", "keyword");
        }

        if content.contains("struct ") || content.contains("@Component") {
            push(
                "build()".to_string(),
                "Component lifecycle method",
                "method",
            );
        }

        for symbol in collect_document_symbols(&content) {
            if symbol.kind == "function" {
                push(
                    format!("{}()", symbol.name),
                    "Fallback function",
                    "function",
                );
            }
        }

        items
    }

    fn document_symbols(&self, request: &LanguageQueryRequest) -> Vec<DocumentSymbol> {
        let Some(content) = load_document_content(&request.path) else {
            return Vec::new();
        };

        collect_document_symbols(&content)
    }

    fn usages(&self, request: &LanguageQueryRequest) -> Vec<UsageResult> {
        let Some(content) = load_document_content(&request.path) else {
            return Vec::new();
        };
        let Some(symbol) = symbol_at_position(&content, request) else {
            return Vec::new();
        };

        collect_symbol_occurrences(&content, &symbol)
            .into_iter()
            .map(|(line, column, preview)| UsageResult {
                path: request.path.clone(),
                line,
                column,
                preview,
            })
            .collect()
    }
}

fn load_document_content(path: &str) -> Option<String> {
    read_text_file(Path::new(path)).ok()
}

fn collect_document_symbols(content: &str) -> Vec<DocumentSymbol> {
    const DECLARATION_KEYWORDS: [&str; 6] =
        ["struct", "class", "interface", "enum", "type", "function"];

    content
        .lines()
        .enumerate()
        .filter_map(|(line_index, line_text)| {
            DECLARATION_KEYWORDS.iter().find_map(|keyword| {
                let declaration = format!("{keyword} ");
                let start = line_text.find(&declaration)?;
                let name_start = start + declaration.len();
                let tail = &line_text[name_start..];
                let name = take_identifier_prefix(tail)?;

                Some(DocumentSymbol {
                    name: name.to_string(),
                    kind: (*keyword).to_string(),
                    line: (line_index + 1) as u32,
                    column: (name_start + 1) as u32,
                })
            })
        })
        .collect()
}

fn collect_symbol_occurrences(content: &str, symbol: &str) -> Vec<(u32, u32, String)> {
    content
        .lines()
        .enumerate()
        .flat_map(|(line_index, line_text)| {
            let mut matches = Vec::new();
            let mut search_start = 0usize;

            while let Some(relative_index) = line_text[search_start..].find(symbol) {
                let start = search_start + relative_index;
                let end = start + symbol.len();
                let before = line_text[..start].chars().last();
                let after = line_text[end..].chars().next();

                if is_identifier_boundary(before) && is_identifier_boundary(after) {
                    matches.push((
                        (line_index + 1) as u32,
                        (start + 1) as u32,
                        line_text.trim().to_string(),
                    ));
                }

                search_start = end;
            }

            matches
        })
        .collect()
}

fn symbol_at_position(content: &str, request: &LanguageQueryRequest) -> Option<String> {
    let line_index = request.line.checked_sub(1)? as usize;
    let line_text = content.lines().nth(line_index)?;
    let bytes = line_text.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let requested = request.column.saturating_sub(1) as usize;
    let mut index = requested.min(bytes.len().saturating_sub(1));

    if !is_identifier_byte(bytes[index]) && index > 0 && is_identifier_byte(bytes[index - 1]) {
        index -= 1;
    }

    if !is_identifier_byte(bytes[index]) {
        return None;
    }

    let mut start = index;
    while start > 0 && is_identifier_byte(bytes[start - 1]) {
        start -= 1;
    }

    let mut end = index + 1;
    while end < bytes.len() && is_identifier_byte(bytes[end]) {
        end += 1;
    }

    Some(line_text[start..end].to_string())
}

fn take_identifier_prefix(input: &str) -> Option<&str> {
    let end = input
        .char_indices()
        .take_while(|(_, ch)| is_identifier_char(*ch))
        .last()
        .map(|(index, ch)| index + ch.len_utf8())?;

    Some(&input[..end])
}

fn is_identifier_boundary(ch: Option<char>) -> bool {
    ch.is_none_or(|value| !is_identifier_char(value))
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}
