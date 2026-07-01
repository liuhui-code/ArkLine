use crate::models::language::LanguageQueryRequest;

pub fn completion_prefix(request: &LanguageQueryRequest) -> String {
    let Some(content) = request.content.as_deref() else {
        return String::new();
    };
    let Some(line) = content.lines().nth(request.line.saturating_sub(1) as usize) else {
        return String::new();
    };
    let end = request.column.saturating_sub(1) as usize;
    let before = line.get(..end.min(line.len())).unwrap_or(line);
    before
        .rsplit(|value: char| !is_identifier_part(value as u8))
        .next()
        .unwrap_or_default()
        .to_string()
}

pub fn member_owner_at_position(request: &LanguageQueryRequest) -> Option<String> {
    let content = request.content.as_deref()?;
    let line = content
        .lines()
        .nth(request.line.saturating_sub(1) as usize)?;
    let end = request.column.saturating_sub(1) as usize;
    let mut before = line.get(..end.min(line.len()))?;
    before = strip_identifier_suffix(before);
    let owner = before.strip_suffix('.')?;
    owner
        .rsplit(|value: char| !is_identifier_part(value as u8) && !matches!(value, '.' | '(' | ')'))
        .next()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn strip_identifier_suffix(value: &str) -> &str {
    let suffix_start = value
        .char_indices()
        .rev()
        .take_while(|(_, character)| is_identifier_part(*character as u8))
        .last()
        .map(|(index, _)| index)
        .unwrap_or(value.len());
    value.get(..suffix_start).unwrap_or(value)
}

pub fn local_variable_name(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))?;
    let end = after_keyword
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(after_keyword.len());
    after_keyword
        .get(..end)
        .filter(|value| is_identifier(value))
}

pub fn local_function_name(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("function ")
        .or_else(|| trimmed.strip_prefix("async function "))?;
    let end = after_keyword.find('(')?;
    after_keyword
        .get(..end)
        .filter(|value| is_identifier(value))
}

fn is_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    is_identifier_start(first) && bytes.all(is_identifier_part)
}

fn is_identifier_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_' || value == b'$'
}

fn is_identifier_part(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}
