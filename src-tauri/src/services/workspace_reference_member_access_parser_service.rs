pub fn member_accesses(line: &str) -> Vec<MemberAccess<'_>> {
    let bytes = line.as_bytes();
    let mut members = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'.' || index + 1 >= bytes.len() {
            index += 1;
            continue;
        }
        let member_start = index + 1;
        if !is_identifier_start(bytes[member_start]) {
            index += 1;
            continue;
        }
        let mut member_end = member_start + 1;
        while member_end < bytes.len() && is_identifier_part(bytes[member_end]) {
            member_end += 1;
        }
        if let (Some(owner), Some(name)) = (
            owner_before_dot(line, index),
            line.get(member_start..member_end),
        ) {
            members.push(MemberAccess {
                owner,
                name,
                column: member_start + 1,
                end_column: member_end + 1,
            });
        }
        index = member_end;
    }
    members
}

pub fn contains_member_access_line(line: &str) -> bool {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] == b'.' && is_identifier_start(bytes[index + 1]) {
            return owner_before_dot(line, index).is_some();
        }
        index += 1;
    }
    false
}

fn owner_before_dot(line: &str, dot_index: usize) -> Option<&str> {
    let bytes = line.as_bytes();
    if dot_index == 0 {
        return None;
    }
    let mut end = dot_index;
    if bytes[end - 1] == b'?' {
        end -= 1;
        if end == 0 {
            return None;
        }
    }
    if bytes[end - 1] == b')' {
        if let Some(owner) = owner_from_grouped_await_call(line, dot_index) {
            return Some(owner);
        }
        end = call_expression_start(bytes, end - 1)?;
    }
    let start = owner_start_before(bytes, 0, end)?;
    line.get(start..end)
}

fn owner_from_grouped_await_call(line: &str, dot_index: usize) -> Option<&str> {
    let bytes = line.as_bytes();
    let close_index = dot_index.checked_sub(1)?;
    let open_index = call_expression_start(bytes, close_index)?;
    let mut inner_start = open_index + 1;
    while inner_start < close_index && bytes[inner_start].is_ascii_whitespace() {
        inner_start += 1;
    }
    if !line.get(inner_start..close_index)?.starts_with("await ") {
        return None;
    }
    inner_start += "await ".len();
    while inner_start < close_index && bytes[inner_start].is_ascii_whitespace() {
        inner_start += 1;
    }
    let mut inner_end = close_index;
    while inner_end > inner_start && bytes[inner_end - 1].is_ascii_whitespace() {
        inner_end -= 1;
    }
    if bytes.get(inner_end.checked_sub(1)?) != Some(&b')') {
        return None;
    }
    let call_open = call_expression_start(bytes, inner_end - 1)?;
    if call_open < inner_start {
        return None;
    }
    let owner_start = owner_start_before(bytes, inner_start, call_open)?;
    line.get(owner_start..call_open)
}

fn owner_start_before(bytes: &[u8], lower_bound: usize, end: usize) -> Option<usize> {
    let mut start = end;
    while start > lower_bound && is_identifier_part(bytes[start - 1]) {
        start -= 1;
    }
    while start > lower_bound + 1 && bytes[start - 1] == b'.' {
        let segment_end = start - 1;
        let mut segment_start = segment_end;
        while segment_start > lower_bound && is_identifier_part(bytes[segment_start - 1]) {
            segment_start -= 1;
        }
        if segment_start == segment_end {
            break;
        }
        start = segment_start;
    }
    (start != end).then_some(start)
}

fn call_expression_start(bytes: &[u8], closing_index: usize) -> Option<usize> {
    let mut depth = 0usize;
    for index in (0..=closing_index).rev() {
        match bytes[index] {
            b')' => depth = depth.saturating_add(1),
            b'(' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

pub fn is_identifier(value: &str) -> bool {
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

pub struct MemberAccess<'a> {
    pub owner: &'a str,
    pub name: &'a str,
    pub column: usize,
    pub end_column: usize,
}
