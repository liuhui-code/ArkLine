use std::collections::HashSet;

use serde_json::json;

use crate::models::language::{CompletionItem, DefinitionTarget};

pub fn completion_item(
    label: &str,
    kind: &str,
    detail: &str,
    source: &str,
    data: Option<serde_json::Value>,
) -> CompletionItem {
    CompletionItem {
        label: label.to_string(),
        detail: detail.to_string(),
        kind: kind.to_string(),
        insert_text: None,
        filter_text: Some(label.trim_end_matches("()").to_string()),
        sort_text: None,
        source: Some(source.to_string()),
        documentation: None,
        replacement_range: None,
        commit_characters: Vec::new(),
        definition_target: None,
        data,
    }
}

pub fn snippet_completion_item(
    label: &str,
    detail: &str,
    insert_text: &str,
    source: &str,
) -> CompletionItem {
    CompletionItem {
        label: label.to_string(),
        detail: detail.to_string(),
        kind: "snippet".to_string(),
        insert_text: Some(insert_text.to_string()),
        filter_text: Some(label.to_string()),
        sort_text: None,
        source: Some(source.to_string()),
        documentation: None,
        replacement_range: None,
        commit_characters: Vec::new(),
        definition_target: None,
        data: None,
    }
}

pub fn symbol_completion_from_row(
    row: &rusqlite::Row<'_>,
    source: &str,
    include_import_data: bool,
) -> rusqlite::Result<CompletionItem> {
    let name: String = row.get(0)?;
    let kind: String = row.get(1)?;
    let signature: Option<String> = row.get(2)?;
    let path: String = row.get(3)?;
    let line: i64 = row.get(4)?;
    let column: i64 = row.get(5)?;
    let symbol_id: String = row.get(6)?;
    let data = include_import_data.then(|| {
        let normalized_path = path.replace('\\', "/");
        json!({
            "symbolId": symbol_id,
            "importPath": normalized_path,
            "completionEdit": {
                "kind": "importPreview",
                "targetPath": normalized_path,
                "applyMode": "explicit",
            },
        })
    });
    Ok(CompletionItem {
        label: label_for_symbol(&name, &kind),
        detail: signature.unwrap_or_else(|| kind.clone()),
        kind,
        insert_text: None,
        filter_text: Some(name),
        sort_text: None,
        source: Some(source.to_string()),
        documentation: None,
        replacement_range: None,
        commit_characters: Vec::new(),
        definition_target: Some(DefinitionTarget {
            path: path.replace('\\', "/"),
            line: u32::try_from(line).unwrap_or_default(),
            column: u32::try_from(column).unwrap_or_default(),
        }),
        data,
    })
}

pub fn dedupe_completion_items(items: Vec<CompletionItem>, limit: usize) -> Vec<CompletionItem> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for item in items {
        let key = item
            .data
            .as_ref()
            .and_then(|data| data.get("symbolId"))
            .and_then(|value| value.as_str())
            .map(|symbol_id| format!("symbol:{symbol_id}"))
            .unwrap_or_else(|| format!("label:{}:{}", item.label, item.kind));
        if seen.insert(key) {
            merged.push(item);
        }
        if merged.len() >= limit {
            break;
        }
    }
    merged
}

fn label_for_symbol(name: &str, kind: &str) -> String {
    if kind == "method" || kind == "function" {
        format!("{name}()")
    } else {
        name.to_string()
    }
}
