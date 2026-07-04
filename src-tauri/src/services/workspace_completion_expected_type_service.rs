use crate::models::language::LanguageQueryRequest;
use crate::services::workspace_reference_member_access_parser_service::is_identifier;

pub fn expected_completion_type(request: &LanguageQueryRequest) -> Option<&str> {
    expected_assignment_type(request).or_else(|| expected_parameter_type(request))
}

fn expected_assignment_type(request: &LanguageQueryRequest) -> Option<&str> {
    let content = request.content.as_deref()?;
    let before = current_line_before_cursor(content, request)?;
    let assignment_start = before.rfind('=')?;
    let left_side = before.get(..assignment_start)?;
    let (_, type_expression) = left_side.rsplit_once(':')?;
    let expected = type_expression.trim();
    is_identifier(expected).then_some(expected)
}

fn expected_parameter_type(request: &LanguageQueryRequest) -> Option<&str> {
    let content = request.content.as_deref()?;
    let before = current_line_before_cursor(content, request)?;
    let call_start = before.rfind('(')?;
    if before.get(call_start + 1..)?.contains(')') {
        return None;
    }
    let callee = identifier_before(before, call_start)?;
    let argument_index = argument_index(before.get(call_start + 1..)?);
    function_parameter_type(content, callee, argument_index)
}

fn current_line_before_cursor<'a>(
    content: &'a str,
    request: &LanguageQueryRequest,
) -> Option<&'a str> {
    let line = content
        .lines()
        .nth(request.line.saturating_sub(1) as usize)?;
    let end = request.column.saturating_sub(1) as usize;
    Some(line.get(..end.min(line.len())).unwrap_or(line))
}

fn identifier_before(line: &str, end: usize) -> Option<&str> {
    let bytes = line.as_bytes();
    let mut cursor = end;
    while cursor > 0 && bytes[cursor - 1].is_ascii_whitespace() {
        cursor -= 1;
    }
    let mut start = cursor;
    while start > 0 && is_identifier_part(bytes[start - 1]) {
        start -= 1;
    }
    line.get(start..cursor)
        .filter(|candidate| is_identifier(candidate))
}

fn argument_index(arguments: &str) -> usize {
    let mut index = 0usize;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    for byte in arguments.bytes() {
        match byte {
            b'(' => paren_depth = paren_depth.saturating_add(1),
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b'[' | b'{' => bracket_depth = bracket_depth.saturating_add(1),
            b']' | b'}' => bracket_depth = bracket_depth.saturating_sub(1),
            b',' if paren_depth == 0 && bracket_depth == 0 => index += 1,
            _ => {}
        }
    }
    index
}

fn function_parameter_type<'a>(
    content: &'a str,
    callee: &str,
    argument_index: usize,
) -> Option<&'a str> {
    for line in content.lines() {
        let Some(signature) = function_signature(line, callee) else {
            continue;
        };
        let parameter = split_parameters(signature).nth(argument_index)?;
        if let Some(expected) = parameter_type(parameter) {
            return Some(expected);
        }
    }
    None
}

fn function_signature<'a>(line: &'a str, callee: &str) -> Option<&'a str> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("function ")
        .or_else(|| trimmed.strip_prefix("async function "))?;
    let after_name = after_keyword.strip_prefix(callee)?;
    if !after_name.starts_with('(') {
        return None;
    }
    let close = after_name.find(')')?;
    after_name.get(1..close)
}

fn split_parameters(signature: &str) -> impl Iterator<Item = &str> {
    signature.split(',').map(str::trim)
}

fn parameter_type(parameter: &str) -> Option<&str> {
    let (_, type_expression) = parameter.rsplit_once(':')?;
    let expected = type_expression.trim();
    is_identifier(expected).then_some(expected)
}

fn is_identifier_part(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}
