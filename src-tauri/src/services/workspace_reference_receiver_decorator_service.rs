pub(super) fn strip_member_decorators(mut value: &str) -> &str {
    loop {
        let trimmed = value.trim_start();
        let Some(mut cursor) = decorator_name_end(trimmed) else {
            return trimmed;
        };
        if trimmed.as_bytes().get(cursor) == Some(&b'(') {
            let Some(end) = decorator_arguments_end(trimmed, cursor) else {
                return trimmed;
            };
            cursor = end;
        }
        let rest = &trimmed[cursor..];
        if !rest.starts_with(char::is_whitespace) {
            return trimmed;
        }
        value = rest;
    }
}

fn decorator_name_end(value: &str) -> Option<usize> {
    if !value.starts_with('@') {
        return None;
    }
    let end = value[1..]
        .find(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '$'
        })
        .map(|offset| offset + 1)
        .unwrap_or(value.len());
    (end > 1).then_some(end)
}

fn decorator_arguments_end(value: &str, start: usize) -> Option<usize> {
    let mut depth = 0_u32;
    let mut quote = None;
    let mut escaped = false;
    for (offset, character) in value[start..].char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == '(' {
            depth += 1;
        } else if character == ')' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(start + offset + character.len_utf8());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::strip_member_decorators;

    #[test]
    fn strips_plain_and_parameterized_member_decorators() {
        assert_eq!(
            strip_member_decorators("  @Watch(\"sync (vm)\") @Local vm: ViewModel"),
            "vm: ViewModel"
        );
        assert_eq!(
            strip_member_decorators("private vm: ViewModel"),
            "private vm: ViewModel"
        );
    }

    #[test]
    fn keeps_malformed_decorators_for_the_caller_to_reject() {
        assert_eq!(
            strip_member_decorators("@Watch(\"vm\" vm: ViewModel"),
            "@Watch(\"vm\" vm: ViewModel"
        );
    }
}
