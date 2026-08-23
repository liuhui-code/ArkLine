use regex::Regex;

pub(super) fn string_field(content: &str, name: &str) -> Option<String> {
    let name = regex::escape(name);
    let pattern = Regex::new(&format!(
        r#"(?:[\"']{name}[\"']|\b{name})\s*:\s*[\"']([^\"']+)[\"']"#,
    ))
    .ok()?;
    pattern
        .captures(content)?
        .get(1)
        .map(|value| value.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn scalar_field(content: &str, name: &str) -> Option<String> {
    let name = regex::escape(name);
    let pattern = Regex::new(&format!(
        r#"(?:[\"']{name}[\"']|\b{name})\s*:\s*(?:[\"']([^\"']+)[\"']|([0-9]+(?:\.[0-9]+)*))"#
    ))
    .ok()?;
    let captures = pattern.captures(content)?;
    captures
        .get(1)
        .or_else(|| captures.get(2))
        .map(|value| value.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn named_object_body<'a>(content: &'a str, name: &str) -> Option<&'a str> {
    let name = regex::escape(name);
    let marker = Regex::new(&format!(r#"(?:[\"']{name}[\"']|\b{name})\s*:\s*\{{"#,)).ok()?;
    let marker_match = marker.find(content)?;
    balanced_body(content, marker_match.end(), '{', '}')
}

pub(super) fn array_objects(content: &str) -> Vec<&str> {
    let bytes = content.as_bytes();
    let mut objects = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] as char == '{' {
            let start = index + 1;
            if let Some(body) = balanced_body(content, start, '{', '}') {
                objects.push(body);
                index = start + body.len() + 1;
                continue;
            }
        }
        index += 1;
    }
    objects
}

pub(super) fn named_profile_values(content: &str, name: &str) -> Vec<String> {
    let Some(array) = named_array_body(content, name) else {
        return Vec::new();
    };
    let name_pattern = Regex::new(r#"(?:["']name["']|\bname)\s*:\s*["']([^"']+)["']"#)
        .expect("profile name pattern should compile");
    name_pattern
        .captures_iter(array)
        .filter_map(|capture| {
            capture
                .get(1)
                .map(|value| value.as_str().trim().to_string())
        })
        .filter(|name| !name.is_empty())
        .fold(Vec::new(), |mut values, name| {
            if !values.contains(&name) {
                values.push(name);
            }
            values
        })
}

pub(super) fn named_array_body<'a>(content: &'a str, name: &str) -> Option<&'a str> {
    let name = regex::escape(name);
    let marker = Regex::new(&format!(r#"(?:[\"']{name}[\"']|\b{name})\s*:\s*\["#,)).ok()?;
    let marker_match = marker.find(content)?;
    balanced_body(content, marker_match.end(), '[', ']')
        .or_else(|| content.get(marker_match.end()..))
}

fn balanced_body(content: &str, start: usize, open: char, close: char) -> Option<&str> {
    let bytes = content.as_bytes();
    let mut depth = 1;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut index = start;
    while index < bytes.len() {
        let current = bytes[index] as char;
        let next = bytes.get(index + 1).copied().map(char::from);
        if line_comment {
            line_comment = current != '\n';
        } else if block_comment {
            if current == '*' && next == Some('/') {
                block_comment = false;
                index += 1;
            }
        } else if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == active_quote {
                quote = None;
            }
        } else if current == '/' && next == Some('/') {
            line_comment = true;
            index += 1;
        } else if current == '/' && next == Some('*') {
            block_comment = true;
            index += 1;
        } else if current == '"' || current == '\'' {
            quote = Some(current);
        } else if current == open {
            depth += 1;
        } else if current == close {
            depth -= 1;
            if depth == 0 {
                return content.get(start..index);
            }
        }
        index += 1;
    }
    None
}
