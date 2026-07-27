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
    let owner = before
        .strip_suffix("?.")
        .or_else(|| before.strip_suffix('.'))?;
    owner
        .rsplit(|value: char| !is_identifier_part(value as u8) && !matches!(value, '.' | '(' | ')'))
        .next()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

pub fn is_member_access_context(request: &LanguageQueryRequest) -> bool {
    let Some(content) = request.content.as_deref() else {
        return false;
    };
    let Some(line) = content.lines().nth(request.line.saturating_sub(1) as usize) else {
        return false;
    };
    let end = request.column.saturating_sub(1) as usize;
    let Some(before) = line.get(..end.min(line.len())) else {
        return false;
    };
    let stripped = strip_identifier_suffix(before);
    let suffix = before.get(stripped.len()..).unwrap_or_default();
    let before = if suffix.is_empty() || is_identifier(suffix) {
        stripped
    } else {
        before
    }
    .trim_end();
    before.ends_with('.')
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

#[cfg(test)]
mod tests {
    use super::{is_member_access_context, member_owner_at_position};
    use crate::models::language::LanguageQueryRequest;

    #[test]
    fn member_context_recognizes_direct_optional_and_chained_access() {
        assert!(is_member_access_context(&request("service.pr")));
        assert!(is_member_access_context(&request("service?.pr")));
        assert!(is_member_access_context(&request("    .wi")));
        assert_eq!(
            member_owner_at_position(&request("service?.pr")).as_deref(),
            Some("service")
        );
    }

    #[test]
    fn member_context_does_not_treat_decimal_literals_as_access() {
        assert!(!is_member_access_context(&request("const value = 1.25")));
    }

    fn request(content: &str) -> LanguageQueryRequest {
        LanguageQueryRequest {
            path: "/workspace/Index.ets".to_string(),
            line: 1,
            column: content.len() as u32 + 1,
            content: Some(content.to_string()),
        }
    }
}
